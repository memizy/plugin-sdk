import type { OQSEItem, MediaObject } from '@memizy/plugin-sdk';

export const SAMPLE_ASSETS: Record<string, MediaObject> = {
  'diagram-cell': {
    type: 'image',
    value:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'>
           <defs>
             <radialGradient id='g' cx='.5' cy='.5' r='.5'>
               <stop offset='0' stop-color='#FFD8A8'/>
               <stop offset='1' stop-color='#FF6F00'/>
             </radialGradient>
           </defs>
           <rect width='320' height='180' fill='#F8F9FA'/>
           <ellipse cx='160' cy='90' rx='120' ry='60' fill='url(#g)' opacity='.3'/>
           <ellipse cx='160' cy='90' rx='80'  ry='40' fill='url(#g)' opacity='.6'/>
           <ellipse cx='160' cy='90' rx='36'  ry='20' fill='#E65100'/>
           <text x='160' y='94' font-family='Inter' font-size='14' font-weight='700'
                 text-anchor='middle' fill='#fff'>MITOCHONDRION</text>
         </svg>`,
      ),
    mimeType: 'image/svg+xml',
    altText: 'Schematic diagram of a cell with its mitochondrion highlighted.',
  },
};

export const SAMPLE_ITEMS: OQSEItem[] = [
  {
    id: 'demo-fc-001',
    type: 'flashcard',
    front:
      'The **powerhouse** of the cell is the <blank:organelle />.\n\n<asset:diagram-cell />',
    back: 'The mitochondrion.',
  },
  {
    id: 'demo-fc-002',
    type: 'flashcard',
    front: 'In which year did the Berlin Wall fall?',
    back: '1989 — specifically on November 9th.',
  },
  {
    id: 'demo-mcq-003',
    type: 'mcq-single',
    question: 'Which planet in our solar system has the most moons?',
    options: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'],
    correctIndex: 1,
  },
  {
    id: 'demo-fc-004',
    type: 'flashcard',
    front: 'What does the acronym **HTTP** stand for?',
    back: 'HyperText Transfer Protocol.',
  },
  {
    id: 'demo-mcq-005',
    type: 'mcq-single',
    question: 'Which of these is **not** a JavaScript runtime?',
    options: ['Node.js', 'Deno', 'Bun', 'Django'],
    correctIndex: 3,
  },
];
