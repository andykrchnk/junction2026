import { z } from 'zod';

export const CameraZod = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().min(0.01).max(100) });
export const ViewZod = z.object({ page: z.string(), camera: CameraZod });

export function readLocal(key: string): unknown {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
        return null;
    }
}

export function writeLocal(key: string, value: unknown): boolean {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}
