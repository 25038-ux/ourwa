import { describe, expect, it } from 'vitest';
import { noteAffichee } from './grades.service.js';

/** El Ourwa : `rtrim(rtrim(number_format($note, 2), '0'), '.')`. Sur la chaîne brute, « 10 » devenait « 1 ». */
describe('la note telle que la famille la lit', () => {
  it.each([
    ['10', '10'],
    ['20', '20'],
    ['0', '0'],
    ['10.00', '10'],
    ['12.50', '12.5'],
    ['12.5', '12.5'],
    ['7.25', '7.25'],
    ['0.50', '0.5'],
  ])('%s → %s', (brut, attendu) => {
    expect(noteAffichee(brut)).toBe(attendu);
  });
});
