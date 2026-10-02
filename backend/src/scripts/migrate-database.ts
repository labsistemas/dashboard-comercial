import { prisma } from '../lib/prisma';
import { execSync } from 'child_process';
import bcrypt from 'bcryptjs';


async function migrateDatabase() {
  console.log('📦 Iniciando verificação e migração do banco de dados...');

  // Tentar corrigir permissões do executável do Prisma (comum em Linux/WSL)
  if (process.platform !== 'win32') {
    try {
      execSync('chmod +x node_modules/.bin/prisma', { stdio: 'ignore' });
    } catch (e) {
      // Ignora erro se não conseguir alterar permissão
    }
  }

  try {
    // 1. Tentar rodar as migrações (criação de tabelas e colunas)
    console.log('🔄 Verificando schema do banco de dados...');
    try {
      // Tenta fazer o deploy das migrations existentes
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
      console.log('✅ Migrations aplicadas com sucesso.');
      // Garantir sincronização do schema mesmo quando não há novas migrations
      console.log('🔁 Sincronizando schema com db push...');
      execSync('npx prisma db push', { stdio: 'inherit' });
      console.log('✅ Schema sincronizado (db push).');
    } catch (error) {
      console.log('⚠️ Falha ao aplicar migrations (deploy). Tentando sincronizar schema (db push)...');
      // Se falhar (ex: sem migrations), faz o push do schema direto
      execSync('npx prisma db push', { stdio: 'inherit' });
      console.log('✅ Schema sincronizado com sucesso (db push).');
    }

    // 2. Popular dados iniciais
    await insertDefaultData(prisma);

  } catch (error) {
    console.error('❌ Erro crítico na migração do banco de dados:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function insertDefaultData(prisma: any) {
  console.log('🌱 Iniciando seed de dados iniciais...');

  // --- 1. Usuário Admin Padrão ---
  try {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      console.log('👤 Criando usuário administrador padrão...');
      const hashedPassword = await bcrypt.hash('123456', 10);
      
      await prisma.user.create({
        data: {
          name: 'Administrador',
          email: 'admin@mail.com',
          password: hashedPassword,
          role: 'admin',
        },
      });
      console.log('✅ Admin criado: admin@mail.com / 123456');
    } else {
      console.log('✅ Usuários já existem. Pular criação de admin.');
    }
  } catch (error) {
    console.error('❌ Erro ao criar admin:', error);
  }

  // --- 2. Matérias Padrão (Subjects) ---
  try {
    const subjectCount = await prisma.subject.count();
    if (subjectCount === 0) {
      console.log('📚 Criando matérias padrão...');
      
      const defaultSubjects = [
        { name: 'Português', color: '#3b82f6', icon: 'book' },
        { name: 'Matemática', color: '#ef4444', icon: 'calculator' },
        { name: 'História', color: '#f59e0b', icon: 'landmark' },
        { name: 'Geografia', color: '#10b981', icon: 'globe' },
        { name: 'Ciências', color: '#8b5cf6', icon: 'microscope' },
        { name: 'Inglês', color: '#ec4899', icon: 'languages' },
      ];

      for (const subject of defaultSubjects) {
        await prisma.subject.create({
          data: subject
        });
      }
      console.log(`✅ ${defaultSubjects.length} matérias criadas.`);
    } else {
      console.log('✅ Matérias já existem. Pular criação.');
    }
  } catch (error) {
    console.error('❌ Erro ao criar matérias:', error);
  }


  console.log('🏁 Seed de dados finalizado.');
}

// Exportar para usar no server.ts
export { migrateDatabase };

// Se rodado diretamente via linha de comando
if (require.main === module) {
  migrateDatabase();
}
