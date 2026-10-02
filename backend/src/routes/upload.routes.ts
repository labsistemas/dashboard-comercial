import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma';
import { validateStorageKey } from '../lib/security';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import { uploadFileToS3, getSignedFileUrl, getPublicUrl, getFileStream } from '../lib/s3';

const router = Router();

// Configurar multer para armazenar em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1, fields: 2, parts: 3,
  },
  fileFilter: (req, file, cb) => {
    // Aceitar vídeo, áudio e documentos
    const allowedMimes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/avif'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido'));
    }
  },
});

// Upload de arquivo
router.post('/', authenticate, rateLimit({ windowMs: 60_000, limit: 5 }), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { folder } = req.body;
    if (folder && !['materials', 'avatars', 'products'].includes(String(folder))) {
      return res.status(400).json({ error: 'Pasta inválida' });
    }
    const fileName = req.file.originalname;
    
    let buffer = req.file.buffer;
    let contentType = req.file.mimetype;
    let finalFileName = fileName;

    // Convert images to WEBP (better browser support than AVIF)
    if (contentType.startsWith('image/') && !contentType.includes('svg')) {
      try {
        buffer = await sharp(req.file.buffer, { limitInputPixels: 20_000_000 })
          .webp({ quality: 82 })
          .toBuffer();
        contentType = 'image/webp';
        finalFileName = fileName.replace(/\.[^/.]+$/, "") + ".webp";
      } catch (conversionError) {
        return res.status(400).json({ error: 'Imagem inválida ou muito grande' });
      }
    }

    const key = await uploadFileToS3({
      file: buffer,
      fileName: finalFileName,
      contentType,
      folder: folder || 'materials',
    });

    // Retornar informações do arquivo
    // Use proxy URL for display if needed, or public URL
    // Since user asked for internal proxy, we return a URL that points to our proxy
    const proxyUrl = `/api/upload/proxy/${key}`;

    res.json({
      key,
      fileName: finalFileName,
      contentType,
      size: buffer.length,
      url: proxyUrl, // Changed to use proxy URL
      publicUrl: getPublicUrl(key) // Keep public URL just in case
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Erro ao fazer upload do arquivo' });
  }
});

// Proxy route for files
router.get('/proxy/:key(*)', async (req, res) => {
  try {
    const { key } = req.params;
    validateStorageKey(key);
    // Public access is limited to images actually referenced by the dashboard.
    const isImage = /\.(?:webp|png|jpe?g|gif|avif)$/i.test(key);
    const referenced = isImage && (
      await prisma.user.count({ where: { avatar: key } }) > 0 ||
      await prisma.product.count({ where: { OR: [{ capaUrl: key }, { capaUrl: `/api/upload/proxy/${key}` }] } }) > 0
    );
    if (!referenced) {
      await authenticate(req, res, () => {});
      if (res.headersSent) return;
    }
    const stream = await getFileStream(key);
    
    // Set appropriate content type based on extension
    const ext = key.split('.').pop()?.toLowerCase();
    const mimeTypes: {[key: string]: string} = {
      'pdf': 'application/pdf',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'avif': 'image/avif',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mp3': 'audio/mpeg',
    };
    
    if (ext && mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
    
    // Cache control
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    if (!ext || !mimeTypes[ext]) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    }
    stream.on('error', () => res.destroy());
    
    stream.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(404).send('File not found');
  }
});

// Obter URL assinada para download/visualização
router.get('/signed-url/:key', authenticate, async (req, res) => {
  try {
    const { key } = req.params;
    const expiresIn = parseInt(req.query.expiresIn as string) || 3600;

    const url = await getSignedFileUrl(key, expiresIn);

    res.json({ url });
  } catch (error: any) {
    console.error('Get signed URL error:', error);
    res.status(500).json({ error: 'Erro ao gerar URL assinada' });
  }
});

export { router as uploadRoutes };
