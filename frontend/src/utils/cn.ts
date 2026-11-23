import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes condicionais e resolve conflito de utilitário do Tailwind (a última vence). */
export function juntarClasses(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas));
}
