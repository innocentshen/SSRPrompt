import { z } from 'zod';
const PasswordSchema = z
    .string()
    .min(8, '密码至少需要8个字符')
    .regex(/[A-Z]/, '密码必须包含至少一个大写字母')
    .regex(/[a-z]/, '密码必须包含至少一个小写字母')
    .regex(/[0-9]/, '密码必须包含至少一个数字');
const VerificationCodeSchema = z
    .string()
    .regex(/^\d{6}$/, '验证码必须是6位数字');
// Register Schema
export const RegisterSchema = z.object({
    email: z.string().email('无效的邮箱地址'),
    password: PasswordSchema,
    name: z.string().min(1).max(100).optional(),
    code: VerificationCodeSchema.optional(),
});
// Send verification code (register/reset_password)
export const SendCodeSchema = z.object({
    email: z.string().email('无效的邮箱地址'),
    type: z.enum(['register', 'reset_password']),
});
// Login Schema
export const LoginSchema = z.object({
    email: z.string().email('无效的邮箱地址'),
    password: z.string().min(1, '请输入密码'),
});
// Change Password Schema
export const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: PasswordSchema,
});
// Forgot password (send reset code)
export const ForgotPasswordSchema = z.object({
    email: z.string().email('无效的邮箱地址'),
});
// Reset password (verify code + set new password)
export const ResetPasswordSchema = z.object({
    email: z.string().email('无效的邮箱地址'),
    code: VerificationCodeSchema,
    newPassword: PasswordSchema,
});
// Update Profile Schema
export const UpdateProfileSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    avatar: z.string().url().optional(),
});
// Refresh Token Schema
export const RefreshTokenSchema = z.object({
    refreshToken: z.string().min(1, '请提供刷新令牌'),
});
//# sourceMappingURL=auth.js.map