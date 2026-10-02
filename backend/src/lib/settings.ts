import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export interface EmailTemplate {
  subject: string;
  body: string; // HTML content
}

export interface Settings {
  allowPublicRegistration: boolean;
  emailTemplates: {
    welcome: EmailTemplate;
    passwordReset: EmailTemplate;
  };
}

const DEFAULT_SETTINGS: Settings = {
  allowPublicRegistration: false,
  emailTemplates: {
    welcome: {
      subject: 'Bem-vindo ao Lab Sistemas!',
      body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Bem-vindo ao Lab Sistemas!</h1>
    </div>
    <div class="content">
      <p>Olá, <strong>{{name}}</strong>!</p>
      <p>Seu cadastro foi realizado com sucesso. Agora você tem acesso a todos os nossos cursos preparatórios para concursos públicos.</p>
      <p>Comece a estudar agora mesmo e alcance seus objetivos!</p>
      <a href="{{frontendUrl}}" class="button">Acessar Plataforma</a>
    </div>
  </div>
</body>
</html>`
    },
    passwordReset: {
      subject: 'Recuperação de Senha - Lab Sistemas',
      body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
    .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Recuperação de Senha</h1>
    </div>
    <div class="content">
      <p>Olá, <strong>{{name}}</strong>!</p>
      <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
      <p>Clique no botão abaixo para criar uma nova senha:</p>
      <a href="{{resetUrl}}" class="button">Redefinir Senha</a>
      <div class="warning">
        <p><strong>⚠️ Importante:</strong></p>
        <p>Este link expira em 1 hora. Se você não solicitou esta alteração, ignore este email.</p>
      </div>
      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        Se o botão não funcionar, copie e cole este link no seu navegador:<br>
        <a href="{{resetUrl}}">{{resetUrl}}</a>
      </p>
    </div>
  </div>
</body>
</html>`
    }
  }
};

export async function getSettings(): Promise<Settings> {
  try {
    await fs.access(SETTINGS_FILE);
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const settings = JSON.parse(data);
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error) {
    // If file doesn't exist, ensure dir exists and write defaults
    await fs.mkdir(DATA_DIR, { recursive: true });
    await saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
