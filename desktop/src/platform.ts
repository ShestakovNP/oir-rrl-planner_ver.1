/** Runtime detection: inside the Tauri desktop shell or a plain browser (dev / preview). */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
