// Browser stand-in for node:crypto, only for the single-file preview build.
export const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min));
export const randomUUID = () =>
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
