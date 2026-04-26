import React, { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import Modal from './ui/Modal'
import { getCroppedImg } from '../utils/cropImage'
import { Upload, X, Loader2 } from 'lucide-react'

interface AvatarUploadModalProps {
  isOpen: boolean
  onClose: () => void
  onUpload: (file: File) => Promise<void>
}

export const AvatarUploadModal: React.FC<AvatarUploadModalProps> = ({ isOpen, onClose, onUpload }) => {
  const [image, setImage] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null)
  const [isUploading, setIsUploading] = useState(false)

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader()
      reader.addEventListener('load', () => setImage(reader.result as string))
      reader.readAsDataURL(e.target.files[0])
    }
  }

  const handleUpload = async () => {
    if (!image || !croppedAreaPixels) return

    try {
      setIsUploading(true)
      const croppedImageBlob = await getCroppedImg(image, croppedAreaPixels)
      if (croppedImageBlob) {
        const file = new File([croppedImageBlob], 'avatar.jpg', { type: 'image/jpeg' })
        await onUpload(file)
        setImage(null)
        onClose()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isUploading) {
          setImage(null)
          onClose()
        }
      }}
      title="Foto de Perfil"
      maxWidth="max-w-sm"
      footer={
        <div className="flex gap-2 w-full justify-end items-center">
           <button 
             onClick={onClose}
             disabled={isUploading}
             className="px-4 py-2 text-[12px] font-bold text-[#37352f]/40 hover:text-[#37352f] transition-colors"
           >
             Cancelar
           </button>
           {image && (
             <button 
               onClick={handleUpload}
               disabled={isUploading}
               className="px-5 py-2.5 text-[12px] font-bold bg-[#1a1a1a] text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2 shadow-sm"
             >
               {isUploading ? <Loader2 size={14} className="animate-spin" /> : 'Salvar Foto'}
             </button>
           )}
        </div>
      }
    >
      <div className="flex flex-col items-center justify-center min-h-[220px]">
        {!image ? (
          <label className="w-full h-44 border-2 border-dashed border-[#f1f1f0] rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-[#fcfcfa] hover:border-[#37352f]/10 transition-all group overflow-hidden relative">
            <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
            <div className="w-12 h-12 rounded-xl bg-[#f7f7f5] flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white group-hover:shadow-sm transition-all duration-300">
               <Upload size={18} className="text-[#37352f]/30 group-hover:text-[#37352f]" />
            </div>
            <div className="text-center space-y-1">
              <span className="text-[13px] font-bold text-[#37352f] block">Carregar nova foto</span>
              <span className="text-[11px] text-[#37352f]/30 block px-8">JPG ou PNG até 1MB</span>
            </div>
          </label>
        ) : (
          <div className="flex flex-col w-full">
            <div className="relative w-full h-80 bg-[#f7f7f5] rounded-3xl overflow-hidden border border-[#e9e9e7] group">
              <Cropper
                image={image}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                cropShape="round"
                showGrid={false}
                style={{
                  containerStyle: { background: '#f7f7f5' },
                  cropAreaStyle: { border: '2px solid white', boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)' }
                }}
              />
              
              <button 
                onClick={() => setImage(null)}
                className="absolute top-4 right-4 p-2 bg-white/80 hover:bg-white text-[#37352f] rounded-full shadow-lg backdrop-blur-md transition-all z-20"
              >
                <X size={14} />
              </button>

              {/* Zoom Control Overlay - Minimal and Elegant */}
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-[80%] bg-white/90 backdrop-blur-md px-4 py-3 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/20 flex flex-col gap-2 z-20 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                <div className="flex justify-between items-center px-0.5">
                  <span className="text-[9px] font-bold text-[#37352f]/40 uppercase tracking-widest">Zoom</span>
                  <span className="text-[10px] font-bold text-[#37352f]">{Math.round(zoom * 100)}%</span>
                </div>
                <input
                  type="range"
                  value={zoom}
                  min={1}
                  max={3}
                  step={0.01}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full h-1 bg-[#37352f]/10 rounded-full appearance-none cursor-pointer accent-[#37352f]"
                />
              </div>
            </div>
            
            <div className="mt-4 text-center">
              <p className="text-[11px] text-[#37352f]/40 font-medium italic">Arraste para ajustar e use o zoom acima.</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
