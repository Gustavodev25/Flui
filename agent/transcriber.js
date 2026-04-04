import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Cliente NVIDIA NIM (mesma key do chat!) — suporta Whisper via OpenAI-compatible API
const nimClient = NVIDIA_API_KEY
  ? new OpenAI({
      apiKey: NVIDIA_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    })
  : null;

// Fallback: Groq (opcional, só se tiver GROQ_API_KEY)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const groqClient = GROQ_API_KEY
  ? new OpenAI({
      apiKey: GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;

/**
 * Baixa o arquivo de mídia do WhatsApp usando a Graph API do Meta.
 *
 * Fluxo:
 * 1. GET no media_id para obter a URL de download
 * 2. GET na URL para baixar o binário
 * 3. Salva em arquivo temporário
 *
 * @param {string} mediaId - ID da mídia do WhatsApp
 * @returns {Promise<{filePath: string, mimeType: string}>}
 */
async function downloadWhatsAppMedia(mediaId) {
  // Passo 1: Obtém a URL de download
  const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
  });

  if (!metaRes.ok) {
    const err = await metaRes.text();
    throw new Error(`Falha ao obter URL da mídia: ${err}`);
  }

  const metaData = await metaRes.json();
  const mediaUrl = metaData.url;
  const mimeType = metaData.mime_type || 'audio/ogg';

  // Passo 2: Baixa o arquivo binário
  const audioRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
  });

  if (!audioRes.ok) {
    throw new Error(`Falha ao baixar mídia: ${audioRes.status}`);
  }

  const buffer = Buffer.from(await audioRes.arrayBuffer());

  // Passo 3: Salva em tmp
  const ext = mimeType.includes('ogg') ? '.ogg' : mimeType.includes('mp4') ? '.m4a' : '.audio';
  const tmpFile = path.join(os.tmpdir(), `wa_audio_${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, buffer);

  console.log(`[Transcriber] Áudio salvo: ${tmpFile} (${(buffer.length / 1024).toFixed(1)}KB, ${mimeType})`);

  return { filePath: tmpFile, mimeType };
}

/**
 * Converte OGG/OPUS para WAV usando ffmpeg (se disponível).
 * Melhora compatibilidade com serviços de STT.
 *
 * @param {string} inputPath
 * @returns {string} Caminho do arquivo convertido (ou o original se ffmpeg não disponível)
 */
function convertToWav(inputPath) {
  const wavPath = inputPath.replace(/\.[^.]+$/, '.wav');

  try {
    execSync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y`, {
      stdio: 'pipe',
      timeout: 15000,
    });
    console.log(`[Transcriber] Convertido para WAV: ${wavPath}`);
    return wavPath;
  } catch {
    console.log('[Transcriber] ffmpeg não disponível, usando arquivo original');
    return inputPath;
  }
}

/**
 * Transcreve usando NVIDIA NIM (Whisper) — mesma API key do chat.
 */
async function transcribeWithNvidia(filePath) {
  if (!nimClient) throw new Error('NVIDIA_API_KEY não configurada');

  const fileStream = fs.createReadStream(filePath);

  const transcription = await nimClient.audio.transcriptions.create({
    file: fileStream,
    model: 'nvidia/parakeet-ctc-1.1b-asr',
    language: 'pt',
    response_format: 'text',
    temperature: 0.0,
  });

  return typeof transcription === 'string' ? transcription.trim() : transcription.text?.trim() || '';
}

/**
 * Transcreve usando Groq Whisper (fallback gratuito).
 */
async function transcribeWithGroq(filePath) {
  if (!groqClient) throw new Error('GROQ_API_KEY não configurada');

  const fileStream = fs.createReadStream(filePath);

  const transcription = await groqClient.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-large-v3',
    language: 'pt',
    response_format: 'text',
    temperature: 0.0,
  });

  return typeof transcription === 'string' ? transcription.trim() : transcription.text?.trim() || '';
}

/**
 * Tenta transcrever usando os serviços disponíveis, em ordem de prioridade:
 * 1. NVIDIA NIM (mesma key do chat)
 * 2. Groq (fallback, se tiver GROQ_API_KEY)
 */
async function transcribe(filePath) {
  // Groq Whisper — rápido e gratuito (primário)
  if (groqClient) {
    try {
      console.log('[Transcriber] Transcrevendo via Groq Whisper...');
      return await transcribeWithGroq(filePath);
    } catch (err) {
      console.warn(`[Transcriber] Groq falhou: ${err.message}`);
    }
  }

  // Fallback: NVIDIA NIM (se Groq não estiver disponível)
  if (nimClient) {
    try {
      console.log('[Transcriber] Tentando NVIDIA NIM (fallback)...');
      return await transcribeWithNvidia(filePath);
    } catch (err) {
      console.warn(`[Transcriber] NVIDIA falhou: ${err.message}`);
    }
  }

  throw new Error('Nenhum serviço de transcrição disponível (GROQ_API_KEY ou NVIDIA_API_KEY necessária)');
}

/**
 * Pipeline completo: baixa áudio do WhatsApp → converte → transcreve → limpa.
 *
 * @param {string} mediaId - ID da mídia do WhatsApp
 * @returns {Promise<{text: string, duration: number}>}
 */
export async function transcribeWhatsAppAudio(mediaId) {
  const startTime = Date.now();
  let downloadedPath = null;
  let convertedPath = null;

  try {
    // 1. Baixa o áudio do WhatsApp
    const { filePath } = await downloadWhatsAppMedia(mediaId);
    downloadedPath = filePath;

    // 2. Converte para WAV (melhor compatibilidade)
    const audioPath = convertToWav(filePath);
    convertedPath = audioPath !== filePath ? audioPath : null;

    // 3. Transcreve (NVIDIA → Groq fallback)
    const text = await transcribe(audioPath);
    const duration = Date.now() - startTime;

    console.log(`[Transcriber] ✅ Transcrição em ${duration}ms: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

    return { text, duration };
  } catch (error) {
    console.error('[Transcriber] ❌ Erro na transcrição:', error.message);
    throw error;
  } finally {
    // Limpa arquivos temporários
    try {
      if (downloadedPath && fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
      if (convertedPath && fs.existsSync(convertedPath)) fs.unlinkSync(convertedPath);
    } catch {
      // ignora erros de limpeza
    }
  }
}
