import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';

const SALT_ROUNDS = 12;
const SYSTEM_USER_ID = 'default';
const SYSTEM_USER_EMAIL = 'default@system.local';
const REQUIRED_ROLE_NAMES = ['admin', 'user', 'viewer'] as const;

type SeedLogger = Pick<typeof console, 'log' | 'warn' | 'error'>;

type PermissionSeed = {
  name: string;
  resource: string;
  action: string;
  description: string;
};

type RoleSeed = {
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
};

export type BootstrapSeedOptions = {
  adminEmail?: string;
  adminPassword?: string;
  logger?: SeedLogger;
};

const DEFAULT_PERMISSIONS: PermissionSeed[] = [
  { name: 'prompts:create', resource: 'prompts', action: 'create', description: 'Create prompts' },
  { name: 'prompts:read', resource: 'prompts', action: 'read', description: 'Read prompts' },
  { name: 'prompts:update', resource: 'prompts', action: 'update', description: 'Update prompts' },
  { name: 'prompts:delete', resource: 'prompts', action: 'delete', description: 'Delete prompts' },
  { name: 'evaluations:create', resource: 'evaluations', action: 'create', description: 'Create evaluations' },
  { name: 'evaluations:read', resource: 'evaluations', action: 'read', description: 'Read evaluations' },
  { name: 'evaluations:update', resource: 'evaluations', action: 'update', description: 'Update evaluations' },
  { name: 'evaluations:delete', resource: 'evaluations', action: 'delete', description: 'Delete evaluations' },
  { name: 'evaluations:run', resource: 'evaluations', action: 'run', description: 'Run evaluations' },
  { name: 'traces:read', resource: 'traces', action: 'read', description: 'Read traces' },
  { name: 'traces:delete', resource: 'traces', action: 'delete', description: 'Delete traces' },
  { name: 'providers:create', resource: 'providers', action: 'create', description: 'Create providers' },
  { name: 'providers:read', resource: 'providers', action: 'read', description: 'Read providers' },
  { name: 'providers:update', resource: 'providers', action: 'update', description: 'Update providers' },
  { name: 'providers:delete', resource: 'providers', action: 'delete', description: 'Delete providers' },
  { name: 'models:create', resource: 'models', action: 'create', description: 'Create models' },
  { name: 'models:read', resource: 'models', action: 'read', description: 'Read models' },
  { name: 'models:update', resource: 'models', action: 'update', description: 'Update models' },
  { name: 'models:delete', resource: 'models', action: 'delete', description: 'Delete models' },
  { name: 'users:read', resource: 'users', action: 'read', description: 'Read users' },
  { name: 'users:update', resource: 'users', action: 'update', description: 'Update users' },
  { name: 'users:delete', resource: 'users', action: 'delete', description: 'Delete users' },
  { name: 'users:manage-roles', resource: 'users', action: 'manage-roles', description: 'Manage user roles' },
  { name: 'roles:create', resource: 'roles', action: 'create', description: 'Create roles' },
  { name: 'roles:read', resource: 'roles', action: 'read', description: 'Read roles' },
  { name: 'roles:update', resource: 'roles', action: 'update', description: 'Update roles' },
  { name: 'roles:delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  { name: 'providers:system', resource: 'providers', action: 'system', description: 'Create system providers' },
];

const DEFAULT_ROLES: RoleSeed[] = [
  {
    name: 'admin',
    description: 'Administrator with full access',
    isSystem: true,
    permissions: DEFAULT_PERMISSIONS.map((p) => p.name),
  },
  {
    name: 'user',
    description: 'Standard user',
    isSystem: true,
    permissions: [
      'prompts:create',
      'prompts:read',
      'prompts:update',
      'prompts:delete',
      'evaluations:create',
      'evaluations:read',
      'evaluations:update',
      'evaluations:delete',
      'evaluations:run',
      'traces:read',
      'providers:create',
      'providers:read',
      'providers:update',
      'providers:delete',
      'models:create',
      'models:read',
      'models:update',
      'models:delete',
    ],
  },
  {
    name: 'viewer',
    description: 'Read-only access',
    isSystem: true,
    permissions: ['prompts:read', 'evaluations:read', 'traces:read', 'providers:read', 'models:read'],
  },
];

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

async function hasSeededTables(prisma: PrismaClient): Promise<boolean> {
  type Row = { table_name: string | null };
  const rows = await prisma.$queryRaw<Row[]>`SELECT to_regclass('public.roles')::text AS table_name`;
  return Boolean(rows[0]?.table_name);
}

async function shouldRunBootstrapSeed(prisma: PrismaClient): Promise<boolean> {
  const [roleCount, systemUser] = await Promise.all([
    prisma.role.count({
      where: {
        name: { in: [...REQUIRED_ROLE_NAMES] },
      },
    }),
    prisma.user.findUnique({
      where: { id: SYSTEM_USER_ID },
      select: { id: true },
    }),
  ]);

  return roleCount < REQUIRED_ROLE_NAMES.length || !systemUser;
}

export async function seedBootstrapData(prisma: PrismaClient, options: BootstrapSeedOptions = {}): Promise<void> {
  const logger = options.logger ?? console;
  const adminEmail = normalizeOptional(options.adminEmail);
  const adminPassword = normalizeOptional(options.adminPassword);

  logger.log('Seeding database bootstrap data...');

  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {
      email: SYSTEM_USER_EMAIL,
      name: 'System',
      status: 'active',
      emailVerified: true,
    },
    create: {
      id: SYSTEM_USER_ID,
      email: SYSTEM_USER_EMAIL,
      name: 'System',
      status: 'active',
      emailVerified: true,
    },
  });

  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: {},
      create: permission,
    });
  }

  for (const role of DEFAULT_ROLES) {
    const { permissions, ...roleData } = role;

    const createdRole = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: roleData,
    });

    const permissionRecords = await prisma.permission.findMany({
      where: { name: { in: permissions } },
      select: { id: true },
    });

    await prisma.rolePermission.deleteMany({
      where: { roleId: createdRole.id },
    });

    await prisma.rolePermission.createMany({
      data: permissionRecords.map((permission) => ({
        roleId: createdRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }

  if (adminEmail && adminPassword) {
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });

    if (!existingAdmin) {
      const adminRole = await prisma.role.findUnique({
        where: { name: 'admin' },
        select: { id: true },
      });

      if (!adminRole) {
        throw new Error('Admin role missing after bootstrap seed');
      }

      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
      await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          name: 'Administrator',
          emailVerified: true,
          status: 'active',
          roles: {
            create: {
              roleId: adminRole.id,
            },
          },
        },
      });

      logger.log(`[Seed] Created admin user: ${adminEmail}`);
    } else {
      logger.log(`[Seed] Admin user already exists: ${adminEmail}`);
    }
  } else if (adminEmail || adminPassword) {
    logger.warn('[Seed] ADMIN_EMAIL and ADMIN_PASSWORD must both be set to create an admin user.');
  } else {
    logger.log('[Seed] Admin user creation skipped (ADMIN_EMAIL or ADMIN_PASSWORD not set).');
  }
}

export async function autoSeedBootstrapData(prisma: PrismaClient, options: BootstrapSeedOptions = {}): Promise<void> {
  const logger = options.logger ?? console;

  if (!(await hasSeededTables(prisma))) {
    logger.warn('[Seed] Roles table not found, skipping auto-seed. Run database migrations first.');
    return;
  }

  if (!(await shouldRunBootstrapSeed(prisma))) {
    logger.log('[Seed] Bootstrap data already initialized, skipping auto-seed.');
    return;
  }

  logger.log('[Seed] Fresh database detected, running bootstrap seed...');
  await seedBootstrapData(prisma, options);
  logger.log('[Seed] Bootstrap seed completed.');
}
