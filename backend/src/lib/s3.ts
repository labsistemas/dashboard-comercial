import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import dotenv from 'dotenv';
import { validateStorageKey } from './security';

// Carregar variáveis de ambiente
dotenv.config();

// Usar variáveis do .env conforme configurado
const AWS_REGION = process.env.STORAGE_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.STORAGE_ACCESS_KEY_ID || '';
const AWS_SECRET_ACCESS_KEY = process.env.STORAGE_SECRET_ACCESS_KEY || '';
const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME || '';
const S3_ENDPOINT = process.env.STORAGE_ENDPOINT;

// Configurar cliente S3 (suporta S3-compatible como MinIO)
const s3ClientConfig: any = {
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
};

// Se tiver endpoint customizado (para MinIO ou outros S3-compatible), adicionar
if (S3_ENDPOINT) {
  s3ClientConfig.endpoint = S3_ENDPOINT;
  s3ClientConfig.forcePathStyle = true; // Necessário para MinIO e alguns S3-compatible
}

const s3Client = new S3Client(s3ClientConfig);

export interface UploadFileParams {
  file: Buffer;
  fileName: string;
  contentType: string;
  folder?: string;
}

export async function uploadFileToS3({
  file,
  fileName,
  contentType,
  folder = 'materials',
}: UploadFileParams): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('Bucket S3 não configurado. Configure STORAGE_BUCKET_NAME no .env');
  }

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('Credenciais não configuradas. Configure STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY no .env');
  }

  // Gerar nome único para o arquivo
  if (!/^[a-zA-Z0-9_-]+$/.test(folder)) throw new Error('Invalid folder');
  const safeName = fileName.split(/[\\/]/).pop()!.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
  const uniqueFileName = `${crypto.randomUUID()}-${safeName}`;
  const key = folder ? `${folder}/${uniqueFileName}` : uniqueFileName;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: validateStorageKey(key),
    Body: file,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Retornar a URL do arquivo (ou a chave para gerar URL assinada depois)
  return key;
}

export async function getSignedFileUrl(key: string, expiresIn: number = 3600): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('Bucket S3 não configurado. Configure STORAGE_BUCKET_NAME no .env');
  }

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('Credenciais não configuradas. Configure STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY no .env');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: validateStorageKey(key),
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: Math.max(60, Math.min(3600, Number.isFinite(expiresIn) ? expiresIn : 3600)) });
  return url;
}

export async function getFileStream(key: string): Promise<any> {
  if (!BUCKET_NAME) {
    throw new Error('Bucket S3 não configurado. Configure STORAGE_BUCKET_NAME no .env');
  }

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('Credenciais não configuradas. Configure STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY no .env');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: validateStorageKey(key),
  });

  const response = await s3Client.send(command);
  return response.Body;
}

export function getPublicUrl(key: string): string {
  // Retorna URL do proxy interno para uso com Docker
  // O proxy está montado em /api/upload/proxy (singular)
  return `/api/upload/proxy/${key}`;
}

export async function deleteFileFromS3(key: string): Promise<void> {
  if (!BUCKET_NAME) {
    throw new Error('Bucket S3 não configurado. Configure STORAGE_BUCKET_NAME no .env');
  }

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('Credenciais não configuradas. Configure STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY no .env');
  }

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: validateStorageKey(key),
  });

  await s3Client.send(command);
}
