import { Router } from 'express';
import { asyncHandler } from '../utils/async-handler.js';
import { usersRepository } from '../repositories/users.repository.js';
import { prisma } from '../config/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '@ssrprompt/shared';
const router = Router();
// Middleware: require admin role
const requireAdmin = asyncHandler(async (req, _res, next) => {
    const roles = req.user?.roles || [];
    if (!roles.includes('admin')) {
        throw new ForbiddenError('Admin access required');
    }
    next();
});
// Apply admin check to all routes
router.use(requireAdmin);
// GET /users - List all users
router.get('/', asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            email: true,
            name: true,
            status: true,
            emailVerified: true,
            createdAt: true,
            lastLoginAt: true,
            roles: {
                include: { role: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });
    const result = users.map((u) => ({
        ...u,
        roles: u.roles.map((r) => r.role.name),
    }));
    res.json({ data: result });
}));
// GET /users/roles - List all roles
router.get('/roles', asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({
        orderBy: { name: 'asc' },
    });
    res.json({ data: roles });
}));
// PUT /users/:id/status - Update user status
router.put('/:id/status', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'inactive', 'suspended'].includes(status)) {
        throw new ValidationError('Invalid status');
    }
    // Prevent self-suspension
    if (id === req.user?.userId && status !== 'active') {
        throw new ValidationError('Cannot change your own status');
    }
    const user = await usersRepository.update(id, { status });
    res.json({ data: user });
}));
// PUT /users/:id/roles - Update user roles
router.put('/:id/roles', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { roles } = req.body;
    if (!Array.isArray(roles) || roles.length === 0) {
        throw new ValidationError('At least one role required');
    }
    // Prevent removing admin from self
    if (id === req.user?.userId && !roles.includes('admin')) {
        throw new ValidationError('Cannot remove admin role from yourself');
    }
    // Get role records
    const roleRecords = await prisma.role.findMany({
        where: { name: { in: roles } },
    });
    if (roleRecords.length !== roles.length) {
        throw new NotFoundError('Role', 'some roles');
    }
    // Update user roles in transaction
    await prisma.$transaction([
        prisma.userRole.deleteMany({ where: { userId: id } }),
        prisma.userRole.createMany({
            data: roleRecords.map((r) => ({ userId: id, roleId: r.id })),
        }),
    ]);
    const updated = await usersRepository.findByIdWithRoles(id);
    res.json({
        data: {
            ...updated,
            roles: updated?.roles.map((r) => r.role.name) || [],
        },
    });
}));
// DELETE /users/:id - Delete user
router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Prevent self-deletion
    if (id === req.user?.userId) {
        throw new ValidationError('不能删除自己');
    }
    // Prevent deleting last admin
    const userRoles = await usersRepository.getRoles(id);
    if (userRoles.includes('admin')) {
        const adminCount = await prisma.userRole.count({
            where: { role: { name: 'admin' } },
        });
        if (adminCount <= 1) {
            throw new ValidationError('不能删除最后一个管理员');
        }
    }
    await usersRepository.delete(id);
    res.status(204).send();
}));
export default router;
//# sourceMappingURL=users.routes.js.map