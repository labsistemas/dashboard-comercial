import webpush from 'web-push';
import dotenv from 'dotenv';

dotenv.config();

const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BF7k0K...'; // Placeholder, user needs to generate
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || '...'; // Placeholder

// Initialize web-push
// We will initialize it in the service to avoid side effects on import if keys are missing
export const initWebPush = () => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('VAPID keys not found. Web Push notifications will not work.');
    console.log('Run: npx web-push generate-vapid-keys to generate them.');
    return;
  }

  webpush.setVapidDetails(
    'mailto:contato@institutomapeando.com.br',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
};

export default webpush;
