import prisma from './prisma';

/**
 * Verifica e desativa cursos expirados
 * Deve ser executado periodicamente (ex: via cron job)
 */
export async function checkAndDeactivateExpiredCourses() {
  try {
    const now = new Date();

    // Encontrar todos os cursos que expiraram mas ainda estão ativos
    const expiredCourses = await (prisma as any).course.findMany({
      where: {
        isActive: true,
        expiresAt: {
          not: null,
          lte: now, // expiresAt <= now
        },
      },
    });

    if (expiredCourses.length === 0) {
      return { deactivated: 0, message: 'Nenhum curso expirado encontrado' };
    }

    // Desativar cursos expirados
    const result = await (prisma as any).course.updateMany({
      where: {
        id: {
          in: expiredCourses.map((c: any) => c.id),
        },
      },
      data: {
        isActive: false,
      },
    });

    // Atualizar status das compras relacionadas para "expired"
    await (prisma as any).purchase.updateMany({
      where: {
        courseId: {
          in: expiredCourses.map((c: any) => c.id),
        },
        status: 'active',
      },
      data: {
        status: 'expired',
      },
    });

    return {
      deactivated: result.count,
      courses: expiredCourses.map((c: any) => ({ id: c.id, name: c.name })),
      message: `${result.count} curso(s) desativado(s) com sucesso`,
    };
  } catch (error) {
    console.error('Error checking expired courses:', error);
    throw error;
  }
}

/**
 * Verifica se um curso está expirado
 */
export function isCourseExpired(course: { expiresAt: Date | null; isActive: boolean }): boolean {
  if (!course.isActive) {
    return true;
  }

  if (!course.expiresAt) {
    return false; // Curso sem data de expiração nunca expira
  }

  return new Date(course.expiresAt) <= new Date();
}

