import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  DEFAULT_FORMULA,
  classicReportCard,
  courseworkMean,
  evaluateSubject,
  fondamentalReportCard,
  formula,
  admissionVerdict,
  equivalentOutOf20,
  performanceBand,
  rank,
  subjectMark,
  type SubjectMarks,
} from '../src/bulletin.js';

const subject = (over: Partial<SubjectMarks> = {}): SubjectMarks => ({
  subjectId: 's1',
  subjectName: 'Mathematiques',
  maxScore: '20',
  coefficient: 1,
  coursework: [],
  exam: null,
  ...over,
});

describe('the absent marker', () => {
  it('is excluded before averaging, not summed', () => {
    // Averaging [-1, 10, 12] gives 7. Excluding first gives 11. The first is
    // wrong, and nothing about a 7 looks wrong.
    expect(courseworkMean(['-1', '10', '12'])!.toString()).toBe('11');
  });

  it('returns null when every mark was an absence', () => {
    expect(courseworkMean(['-1', '-1'])).toBeNull();
  });

  it('never lets an absent exam pull a subject down', () => {
    const result = evaluateSubject(subject({ coursework: ['14'], exam: '-1' }), DEFAULT_FORMULA);
    // Only the coursework counts, returned unchanged.
    expect(result.mark!.toString()).toBe('14');
    expect(result.exam).toBeNull();
  });

  it('marks a subject as all-absent when nothing was sat', () => {
    const result = evaluateSubject(subject({ coursework: ['-1'], exam: '-1' }), DEFAULT_FORMULA);
    expect(result.mark).toBeNull();
    expect(result.allAbsent).toBe(true);
  });
});

describe('the weighted subject formula', () => {
  it('applies (coursework x 2 + exam x 3) / 5', () => {
    // (10*2 + 15*3) / 5 = 13
    expect(subjectMark(new Decimal(10), new Decimal(15), DEFAULT_FORMULA)!.toString()).toBe('13');
  });

  it('returns a lone component unchanged rather than halving it', () => {
    expect(subjectMark(new Decimal(12), null, DEFAULT_FORMULA)!.toString()).toBe('12');
    expect(subjectMark(null, new Decimal(8), DEFAULT_FORMULA)!.toString()).toBe('8');
  });

  it('returns null when neither component exists', () => {
    expect(subjectMark(null, null, DEFAULT_FORMULA)).toBeNull();
  });

  it('survives a divisor of zero instead of flattening every report card', () => {
    // Falls back to the sum of the weights: (10*2 + 15*3) / 5 = 13.
    const broken = formula(2, 3, 0);
    expect(subjectMark(new Decimal(10), new Decimal(15), broken)!.toString()).toBe('13');
  });

  it('falls back again when the weights are zero too', () => {
    const veryBroken = formula(0, 0, 0);
    expect(subjectMark(new Decimal(10), new Decimal(15), veryBroken)!.toString()).toBe('0');
  });

  it('honours a level-specific formula', () => {
    // (10*1 + 20*1) / 2 = 15
    expect(subjectMark(new Decimal(10), new Decimal(20), formula(1, 1, 2))!.toString()).toBe('15');
  });
});

describe('regime A - college and lycee', () => {
  it('rescales a subject that is not marked out of 20', () => {
    const result = evaluateSubject(
      subject({ maxScore: '40', coursework: ['30'], exam: '30' }),
      DEFAULT_FORMULA,
    );
    expect(result.mark!.toString()).toBe('30'); // on its own scale
    expect(result.markOutOf20!.toString()).toBe('15'); // 30/40 -> 15/20
  });

  it('keeps the general average within 20 even with a /50 subject', () => {
    const result = classicReportCard(
      [
        subject({ subjectId: 'a', maxScore: '20', coursework: ['18'], exam: '18' }),
        subject({ subjectId: 'b', maxScore: '50', coursework: ['48'], exam: '48' }),
      ],
      DEFAULT_FORMULA,
    );
    // Without rescaling this would be (18 + 48) / 2 = 33.
    expect(result.average!.lessThanOrEqualTo(20)).toBe(true);
    expect(result.average!.toDecimalPlaces(2).toString()).toBe('18.6');
  });

  it('weights by coefficient', () => {
    const result = classicReportCard(
      [
        subject({ subjectId: 'a', coefficient: 4, coursework: ['20'], exam: '20' }),
        subject({ subjectId: 'b', coefficient: 1, coursework: ['10'], exam: '10' }),
      ],
      DEFAULT_FORMULA,
    );
    // (20*4 + 10*1) / 5 = 18
    expect(result.average!.toString()).toBe('18');
    expect(result.totalCoefficients).toBe(5);
  });

  it('ignores unmarked subjects in both the numerator and the divisor', () => {
    const result = classicReportCard(
      [
        subject({ subjectId: 'a', coefficient: 2, coursework: ['15'], exam: '15' }),
        subject({ subjectId: 'b', coefficient: 3 }), // nothing sat
      ],
      DEFAULT_FORMULA,
    );
    expect(result.average!.toString()).toBe('15');
    expect(result.totalCoefficients).toBe(2); // not 5
  });

  it('returns null rather than zero when nothing has been marked', () => {
    const result = classicReportCard([subject()], DEFAULT_FORMULA);
    // A student who has sat nothing has no average. Zero would read as failure.
    expect(result.average).toBeNull();
  });
});

describe('regime B - fondamental', () => {
  it('produces a TOTAL out of the sum of the scales, not an average', () => {
    const result = fondamentalReportCard([
      subject({ subjectId: 'calcul', maxScore: '50', coursework: ['40'], exam: '30' }),
      subject({ subjectId: 'lecture', maxScore: '30', coursework: ['20'], exam: '10' }),
    ]);
    // (40+30)/2 = 35 out of 50 ; (20+10)/2 = 15 out of 30
    expect(result.points.toString()).toBe('50');
    expect(result.outOf.toString()).toBe('80');
  });

  it('uses a plain average of the two components, NOT the weighted formula', () => {
    const result = fondamentalReportCard([
      subject({ maxScore: '20', coursework: ['10'], exam: '20' }),
    ]);
    // Plain: (10+20)/2 = 15. Weighted would give (10*2+20*3)/5 = 16.
    expect(result.points.toString()).toBe('15');
  });

  it('applies no coefficients', () => {
    const result = fondamentalReportCard([
      subject({ subjectId: 'a', coefficient: 9, maxScore: '20', coursework: ['10'], exam: '10' }),
      subject({ subjectId: 'b', coefficient: 1, maxScore: '20', coursework: ['20'], exam: '20' }),
    ]);
    expect(result.points.toString()).toBe('30'); // 10 + 20, unweighted
    expect(result.outOf.toString()).toBe('40');
  });

  it('counts only the scales of subjects actually marked', () => {
    const result = fondamentalReportCard([
      subject({ subjectId: 'a', maxScore: '50', coursework: ['25'], exam: '25' }),
      subject({ subjectId: 'b', maxScore: '30' }), // nothing sat
    ]);
    expect(result.points.toString()).toBe('25');
    expect(result.outOf.toString()).toBe('50'); // not 80
  });

  it('offers a /20 equivalent for display without making it the printed figure', () => {
    const result = fondamentalReportCard([
      subject({ maxScore: '50', coursework: ['25'], exam: '25' }),
    ]);
    expect(result.equivalentOutOf20!.toString()).toBe('10');
  });
});

describe('performance bands', () => {
  it('matches El Ourwa exactly at every boundary', () => {
    expect(performanceBand(16)).toBe('Très Bien');
    expect(performanceBand('15.99')).toBe('Bien');
    expect(performanceBand(14)).toBe('Bien');
    expect(performanceBand('13.99')).toBe('Assez Bien');
    expect(performanceBand(12)).toBe('Assez Bien');
    expect(performanceBand('11.99')).toBe('Passable');
    expect(performanceBand(10)).toBe('Passable');
    expect(performanceBand('9.99')).toBe('Insuffisant');
  });
});

describe('ranking', () => {
  it('orders by score, highest first', () => {
    const r = rank([
      { studentId: 'a', score: new Decimal(12) },
      { studentId: 'b', score: new Decimal(18) },
      { studentId: 'c', score: new Decimal(15) },
    ]);
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(2);
    expect(r.get('a')).toBe(3);
  });

  it('shares a rank on a tie and skips the next', () => {
    const r = rank([
      { studentId: 'a', score: new Decimal(18) },
      { studentId: 'b', score: new Decimal(18) },
      { studentId: 'c', score: new Decimal(10) },
    ]);
    expect(r.get('a')).toBe(1);
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(3); // not 2
  });

  it('leaves a student with no marks unranked rather than last', () => {
    const r = rank([
      { studentId: 'a', score: new Decimal(12) },
      { studentId: 'b', score: null },
    ]);
    expect(r.get('a')).toBe(1);
    // Having sat nothing is not the same as having failed everything.
    expect(r.get('b')).toBeNull();
  });
});

/**
 * LA DÉCISION D'ADMISSION — `verdict_admission()` dans
 * `includes/bulletin_admission.php`, imprimée en bas du bulletin officiel.
 *
 * ⚠ ELLE N'EXISTAIT PAS. Notre bulletin ne portait ni seuil, ni verdict, ni
 * appréciation : il s'arrêtait à la moyenne. Le document officiel mauritanien
 * porte « Admis / Ajourné » en toutes lettres, dans les deux langues, et c'est
 * la ligne que la famille lit en premier.
 */
describe('la décision d’admission', () => {
  it('⚠ une moyenne ABSENTE ne rend pas l’élève ajourné', () => {
    // C'est la règle qui compte le plus. Un élève dont aucune note n'est encore
    // saisie n'a pas échoué : il n'est pas évalué. Le confondre avec un échec
    // imprime « Ajourné » sur le bulletin d'un enfant qui n'a rien passé.
    const v = admissionVerdict(null, 10, 'M');
    expect(v.status).toBe('non_evalue');
    expect(v.label).toBe('Non évalué');
    expect(v.labelAr).toBe('غير مقيّم');
    expect(v.cssClass).toBe('');
  });

  it('⚠ tolère un centième — 9,995 s’affiche 10,00 et doit passer', () => {
    // Son commentaire : « Tolérance d'un centième : 9,995 arrondi à 10,00 à
    // l'écran doit être admis. » Sans elle, le bulletin imprime 10,00 à côté
    // d'« Ajourné », et personne ne peut expliquer la contradiction.
    expect(admissionVerdict(9.995, 10, 'M').status).toBe('admis');
    expect(admissionVerdict(9.99, 10, 'M').status).toBe('ajourne');
  });

  it('⚠ le verdict s’accorde au genre, dans les deux langues', () => {
    expect(admissionVerdict(14, 10, 'M').label).toBe('Admis');
    expect(admissionVerdict(14, 10, 'F').label).toBe('Admise');
    expect(admissionVerdict(14, 10, 'F').labelAr).toBe('ناجحة');
    expect(admissionVerdict(5, 10, 'F').label).toBe('Ajournée');
    expect(admissionVerdict(5, 10, 'F').labelAr).toBe('مؤجلة');
    // Un sexe inconnu prend le masculin, comme le sien (`$sexe === 'F'`).
    expect(admissionVerdict(14, 10, null).label).toBe('Admis');
  });

  it('le seuil est celui du niveau, pas 10 partout', () => {
    expect(admissionVerdict(11, 12, 'M').status).toBe('ajourne');
    expect(admissionVerdict(12, 12, 'M').status).toBe('admis');
  });

  it('⚠ un niveau fondamental se compare en ÉQUIVALENT /20', () => {
    // « points obtenus ÷ total des barèmes × 20 ». Comparer des points bruts à
    // un seuil sur 20 déclarerait ajourné tout élève d'un barème supérieur.
    expect(equivalentOutOf20(true, 150, 300)).toBe(10);
    expect(equivalentOutOf20(true, null, 300)).toBeNull();
    expect(equivalentOutOf20(true, 150, 0)).toBeNull();
    // Un niveau classique est déjà sur 20 : la valeur ressort telle quelle.
    expect(equivalentOutOf20(false, 13.5, null)).toBe(13.5);
  });

  it('l’appréciation suit ses cinq bornes', () => {
    expect(performanceBand(16)).toBe('Très Bien');
    expect(performanceBand(15.99)).toBe('Bien');
    expect(performanceBand(12)).toBe('Assez Bien');
    expect(performanceBand(10)).toBe('Passable');
    expect(performanceBand(9.99)).toBe('Insuffisant');
  });
});
