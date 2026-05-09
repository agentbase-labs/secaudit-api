import { z } from 'zod';
import { emailSchema } from './auth';

export const ContactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: emailSchema,
  companyName: z.string().trim().max(200).optional().or(z.literal('')),
  message: z.string().trim().min(10, 'Tell us a bit more').max(5000),
});
export type ContactInput = z.infer<typeof ContactSchema>;
