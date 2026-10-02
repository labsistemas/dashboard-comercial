import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

type AvatarPart = 'full' | 'head' | 'hair' | 'eyes' | 'outfit' | 'arms' | 'legs' | 'gun';
type AvatarConfig = {
  gender: 'masculino' | 'feminino';
  skin: string;
  hairStyle: 'spiky' | 'short' | 'long' | 'bun';
  hair: string;
  eye: string;
  eyeStyle: 'normal' | 'determinado' | 'fofo';
  outfit: 'tatico' | 'casual' | 'social';
  outfitModel: 'operador' | 'agente' | 'assalto';
  outfitColor: string;
};

const loadAvatarPack = async (): Promise<{
  DEFAULT_AVATAR: AvatarConfig;
  renderAvatarSvgString: (cfg: AvatarConfig, part: AvatarPart) => string;
}> => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const avatarPackPath = path.join(repoRoot, 'frontend', 'src', 'lib', 'avatarPack.ts');
  const mod = (await import(pathToFileURL(avatarPackPath).href)) as any;
  return { DEFAULT_AVATAR: mod.DEFAULT_AVATAR, renderAvatarSvgString: mod.renderAvatarSvgString };
};

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const outRoot = path.join(repoRoot, 'frontend', 'public', 'avatar');

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const writePng = async ({
  relPath,
  cfg,
  part,
  renderAvatarSvgString,
}: {
  relPath: string;
  cfg: AvatarConfig;
  part: AvatarPart;
  renderAvatarSvgString: (cfg: AvatarConfig, part: AvatarPart) => string;
}) => {
  const svg = renderAvatarSvgString(cfg, part);
  const outPath = path.join(outRoot, relPath);
  ensureDir(path.dirname(outPath));
  await sharp(Buffer.from(svg), { density: 300 }).png().toFile(outPath);
};

const main = async () => {
  ensureDir(outRoot);

  const { DEFAULT_AVATAR, renderAvatarSvgString } = await loadAvatarPack();
  const base = DEFAULT_AVATAR;

  await writePng({ relPath: path.join('full', 'avatar-exemplo.png'), cfg: base, part: 'full', renderAvatarSvgString });

  await writePng({ relPath: path.join('head', 'cabeca.png'), cfg: base, part: 'head', renderAvatarSvgString });

  for (const eyeStyle of ['normal', 'determinado', 'fofo'] as const) {
    await writePng({
      relPath: path.join('eyes', `olhos-${eyeStyle}.png`),
      cfg: { ...base, eyeStyle },
      part: 'eyes',
      renderAvatarSvgString,
    });
  }

  for (const hairStyle of ['spiky', 'short', 'long', 'bun'] as const) {
    await writePng({
      relPath: path.join('hair', `cabelo-${hairStyle}.png`),
      cfg: { ...base, hairStyle },
      part: 'hair',
      renderAvatarSvgString,
    });
  }

  for (const outfit of ['tatico', 'casual', 'social'] as const) {
    const models = outfit === 'tatico' ? (['operador', 'agente', 'assalto'] as const) : (['operador'] as const);

    await writePng({
      relPath: path.join('arms', `bracos-${outfit}.png`),
      cfg: { ...base, outfit, outfitModel: models[0] },
      part: 'arms',
      renderAvatarSvgString,
    });

    await writePng({
      relPath: path.join('legs', `pernas-${outfit}.png`),
      cfg: { ...base, outfit, outfitModel: models[0] },
      part: 'legs',
      renderAvatarSvgString,
    });

    for (const outfitModel of models) {
      await writePng({
        relPath: path.join('outfit', `roupa-${outfit}-${outfitModel}.png`),
        cfg: { ...base, outfit, outfitModel },
        part: 'outfit',
        renderAvatarSvgString,
      });

      if (outfit === 'tatico') {
        await writePng({
          relPath: path.join('gun', `arma-${outfitModel}.png`),
          cfg: { ...base, outfit, outfitModel },
          part: 'gun',
          renderAvatarSvgString,
        });
      }
    }
  }

  process.stdout.write(`Export concluído: ${outRoot}\n`);
};

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exitCode = 1;
});
