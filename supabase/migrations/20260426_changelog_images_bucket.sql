-- Bucket público para imagens do changelog
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'changelog-images',
  'changelog-images',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Qualquer pessoa pode visualizar as imagens (bucket público)
CREATE POLICY "Public read changelog images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'changelog-images');

-- Apenas usuários autenticados podem fazer upload (admin no painel)
CREATE POLICY "Authenticated upload changelog images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'changelog-images' AND auth.role() = 'authenticated');

-- Apenas usuários autenticados podem deletar
CREATE POLICY "Authenticated delete changelog images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'changelog-images' AND auth.role() = 'authenticated');
