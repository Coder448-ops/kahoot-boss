/* KAHOOT BOSS — authorized test-environment question bank + session builder.
   These are original practice questions used ONLY for the local simulation
   mode. They are not Kahoot content and never touch Kahoot servers. */

import type { Question } from '../lib/types';
import { seededShuffle, uid } from '../lib/utils';

interface BankItem {
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  category: string;
  kind: Question['kind'];
  timeLimitSec: number;
  imageHint?: string;
}

const BANK: BankItem[] = [
  { text: 'What is 12 × 8?', options: ['86', '96', '104', '88'], correctIndex: 1, explanation: '12 × 8 = 96.', category: 'Math', kind: 'math', timeLimitSec: 20 },
  { text: 'Solve: (15 + 9) ÷ 4', options: ['4', '6', '8', '5'], correctIndex: 1, explanation: '(15 + 9) ÷ 4 = 24 ÷ 4 = 6.', category: 'Math', kind: 'math', timeLimitSec: 20 },
  { text: 'What is 15% of 200?', options: ['25', '30', '35', '20'], correctIndex: 1, explanation: '15% of 200 = 0.15 × 200 = 30.', category: 'Math', kind: 'math', timeLimitSec: 20 },
  { text: 'What is 7² + 3²?', options: ['58', '52', '49', '64'], correctIndex: 0, explanation: '7² + 3² = 49 + 9 = 58.', category: 'Math', kind: 'math', timeLimitSec: 25 },
  { text: 'A train travels 120 km in 2 hours. What is its speed in km/h?', options: ['50', '55', '60', '65'], correctIndex: 2, explanation: 'Speed = distance ÷ time = 120 ÷ 2 = 60 km/h.', category: 'Math', kind: 'math', timeLimitSec: 25 },
  { text: 'What is √144?', options: ['10', '11', '12', '14'], correctIndex: 2, explanation: '√144 = 12 because 12 × 12 = 144.', category: 'Math', kind: 'math', timeLimitSec: 20 },
  { text: 'What is the capital of France?', options: ['Berlin', 'Paris', 'Madrid', 'Rome'], correctIndex: 1, explanation: 'Paris is the capital of France.', category: 'Geography', kind: 'text', timeLimitSec: 20 },
  { text: 'What is the capital of Uzbekistan?', options: ['Samarkand', 'Bukhara', 'Tashkent', 'Khiva'], correctIndex: 2, explanation: 'Tashkent is the capital of Uzbekistan.', category: 'Geography', kind: 'text', timeLimitSec: 20 },
  { text: 'Which is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3, explanation: 'The Pacific Ocean is the largest and deepest ocean.', category: 'Geography', kind: 'text', timeLimitSec: 20 },
  { text: 'Mount Everest lies on the border of Nepal and which country?', options: ['India', 'China', 'Bhutan', 'Pakistan'], correctIndex: 1, explanation: 'Everest sits on the Nepal–China (Tibet) border.', category: 'Geography', kind: 'text', timeLimitSec: 25 },
  { text: 'Which gas do plants absorb for photosynthesis?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], correctIndex: 1, explanation: 'Plants absorb CO₂ and release oxygen during photosynthesis.', category: 'Science', kind: 'text', timeLimitSec: 20 },
  { text: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], correctIndex: 2, explanation: 'Au comes from the Latin “aurum”.', category: 'Science', kind: 'text', timeLimitSec: 20 },
  { text: 'Which planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], correctIndex: 1, explanation: 'Mars appears red due to iron oxide on its surface.', category: 'Science', kind: 'text', timeLimitSec: 20 },
  { text: 'How many bones are in the adult human body?', options: ['186', '206', '226', '256'], correctIndex: 1, explanation: 'An adult human skeleton has 206 bones.', category: 'Science', kind: 'text', timeLimitSec: 20 },
  { text: 'What is H2O commonly known as?', options: ['Salt', 'Water', 'Sugar', 'Alcohol'], correctIndex: 1, explanation: 'H₂O is the chemical formula for water.', category: 'Science', kind: 'text', timeLimitSec: 15 },
  { text: 'Which organelle is called the powerhouse of the cell?', options: ['Nucleus', 'Ribosome', 'Mitochondria', 'Golgi body'], correctIndex: 2, explanation: 'Mitochondria generate ATP, the cell’s energy currency.', category: 'Science', kind: 'text', timeLimitSec: 20 },
  { text: 'What does CPU stand for?', options: ['Central Process Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility'], correctIndex: 1, explanation: 'CPU = Central Processing Unit.', category: 'Technology', kind: 'text', timeLimitSec: 20 },
  { text: 'How many bits are in one byte?', options: ['4', '8', '16', '32'], correctIndex: 1, explanation: 'One byte = 8 bits.', category: 'Technology', kind: 'text', timeLimitSec: 15 },
  { text: 'Which language runs natively in web browsers?', options: ['Python', 'C++', 'JavaScript', 'Rust'], correctIndex: 2, explanation: 'JavaScript is the native language of web browsers.', category: 'Technology', kind: 'text', timeLimitSec: 20 },
  { text: 'What does RAM stand for?', options: ['Random Access Memory', 'Read Access Machine', 'Rapid Action Module', 'Remote Access Memory'], correctIndex: 0, explanation: 'RAM = Random Access Memory.', category: 'Technology', kind: 'text', timeLimitSec: 20 },
  { text: 'Who stepped onto the Moon first?', options: ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'Michael Collins'], correctIndex: 2, explanation: 'Neil Armstrong, Apollo 11, July 20, 1969.', category: 'History', kind: 'text', timeLimitSec: 20 },
  { text: 'In which year did World War II end?', options: ['1939', '1943', '1945', '1950'], correctIndex: 2, explanation: 'World War II ended in 1945.', category: 'History', kind: 'text', timeLimitSec: 20 },
  { text: 'Who painted the Mona Lisa?', options: ['Van Gogh', 'Picasso', 'Da Vinci', 'Rembrandt'], correctIndex: 2, explanation: 'Leonardo da Vinci painted the Mona Lisa.', category: 'History', kind: 'text', timeLimitSec: 20 },
  { text: 'The image shows the Eiffel Tower. In which city is it located?', options: ['London', 'Paris', 'Berlin', 'Madrid'], correctIndex: 1, explanation: 'The Eiffel Tower is in Paris, France.', category: 'Geography', kind: 'image', timeLimitSec: 20, imageHint: 'Iron lattice tower' },
  { text: 'The image shows a red planet in the night sky. Which planet is it?', options: ['Venus', 'Mars', 'Jupiter', 'Saturn'], correctIndex: 1, explanation: 'Mars is the visibly red planet.', category: 'Science', kind: 'image', timeLimitSec: 20, imageHint: 'Reddish disc' },
  { text: 'The image shows the chemical formula H2O on a lab poster. What substance is it?', options: ['Salt', 'Water', 'Oxygen', 'Acid'], correctIndex: 1, explanation: 'H₂O is water.', category: 'Science', kind: 'image', timeLimitSec: 20, imageHint: 'Lab poster' },
  { text: 'A sequence goes 2, 6, 12, 20, 30, … What comes next?', options: ['40', '42', '44', '36'], correctIndex: 1, explanation: 'Differences grow by 2 (4, 6, 8, 10, 12…), so 30 + 12 = 42.', category: 'Logic', kind: 'text', timeLimitSec: 30 },
  { text: 'If all Bloops are Razzies and all Razzies are Lazzies, then all Bloops are…?', options: ['Not Lazzies', 'Lazzies', 'Razzies only', 'Cannot tell'], correctIndex: 1, explanation: 'Transitivity: Bloop → Razzie → Lazzie.', category: 'Logic', kind: 'text', timeLimitSec: 30 },
];

export function getQuestionBankSize(): number {
  return BANK.length;
}

export function getCategories(): string[] {
  return [...new Set(BANK.map((b) => b.category))];
}

/** Build a fresh set of session questions (shuffled, optionally time-overridden). */
export function buildSessionQuestions(count: number, timeLimitOverride: number | null, seed = Date.now()): Question[] {
  const shuffled = seededShuffle(BANK, seed);
  const picked = shuffled.slice(0, Math.max(1, Math.min(count, shuffled.length)));
  return picked.map((b) => ({
    id: uid('q'),
    text: b.text,
    options: [...b.options],
    correctIndex: b.correctIndex,
    explanation: b.explanation,
    category: b.category,
    kind: b.kind,
    timeLimitSec: timeLimitOverride ?? b.timeLimitSec,
    imageHint: b.imageHint,
  }));
}
