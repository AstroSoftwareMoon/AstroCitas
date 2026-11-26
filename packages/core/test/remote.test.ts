import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from '../src/remote';

describe('normalizeServerUrl', () => {
  it('un dominio sin esquema va por https', () => {
    expect(normalizeServerUrl('citas.ejemplo.es/')).toBe('https://citas.ejemplo.es');
  });
  it('una IP local o localhost va por http (servidor sin dominio)', () => {
    expect(normalizeServerUrl('192.168.1.40')).toBe('http://192.168.1.40');
    expect(normalizeServerUrl('192.168.1.40:8080')).toBe('http://192.168.1.40:8080');
    expect(normalizeServerUrl('localhost')).toBe('http://localhost');
  });
  it('respeta el esquema escrito', () => {
    expect(normalizeServerUrl('http://citas.ejemplo.es')).toBe('http://citas.ejemplo.es');
    expect(normalizeServerUrl(' https://10.0.0.2 ')).toBe('https://10.0.0.2');
  });
});
