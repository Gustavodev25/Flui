-- Adiciona coluna due_time na tabela tasks para armazenar o horário da tarefa
-- Formato: "HH:MM:SS" (string) ou NULL se não definido
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TEXT DEFAULT NULL;
