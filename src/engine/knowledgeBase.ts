/* KAHOOT BOSS — local knowledge base for the offline solver.
   Curated fact entries: trigger phrases -> canonical answer + explanation.
   Matching is done with normalized token overlap + fuzzy comparison. */

export interface KnowledgeEntry {
  triggers: string[];
  answer: string;
  aliases: string[];
  explanation: string;
  category: string;
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  // ---- Geography ----
  { triggers: ['capital of france'], answer: 'Paris', aliases: ['paris'], explanation: 'Paris is the capital city of France.', category: 'Geography' },
  { triggers: ['capital of uzbekistan'], answer: 'Tashkent', aliases: ['tashkent', 'toshkent'], explanation: 'Tashkent is the capital city of Uzbekistan.', category: 'Geography' },
  { triggers: ['capital of japan'], answer: 'Tokyo', aliases: ['tokyo'], explanation: 'Tokyo is the capital city of Japan.', category: 'Geography' },
  { triggers: ['capital of germany'], answer: 'Berlin', aliases: ['berlin'], explanation: 'Berlin is the capital city of Germany.', category: 'Geography' },
  { triggers: ['capital of italy'], answer: 'Rome', aliases: ['rome', 'roma'], explanation: 'Rome is the capital city of Italy.', category: 'Geography' },
  { triggers: ['capital of spain'], answer: 'Madrid', aliases: ['madrid'], explanation: 'Madrid is the capital city of Spain.', category: 'Geography' },
  { triggers: ['capital of united kingdom', 'capital of england', 'capital of britain'], answer: 'London', aliases: ['london'], explanation: 'London is the capital of the United Kingdom.', category: 'Geography' },
  { triggers: ['capital of usa', 'capital of america', 'capital of united states'], answer: 'Washington', aliases: ['washington', 'washington d.c.', 'washington dc'], explanation: 'Washington, D.C. is the capital of the United States.', category: 'Geography' },
  { triggers: ['capital of russia'], answer: 'Moscow', aliases: ['moscow', 'moskva'], explanation: 'Moscow is the capital city of Russia.', category: 'Geography' },
  { triggers: ['capital of china'], answer: 'Beijing', aliases: ['beijing', 'peking'], explanation: 'Beijing is the capital city of China.', category: 'Geography' },
  { triggers: ['capital of australia'], answer: 'Canberra', aliases: ['canberra'], explanation: 'Canberra — not Sydney — is the capital of Australia.', category: 'Geography' },
  { triggers: ['capital of canada'], answer: 'Ottawa', aliases: ['ottawa'], explanation: 'Ottawa is the capital city of Canada.', category: 'Geography' },
  { triggers: ['capital of turkey', 'capital of turkiye'], answer: 'Ankara', aliases: ['ankara'], explanation: 'Ankara is the capital of Türkiye (not Istanbul).', category: 'Geography' },
  { triggers: ['largest desert', 'biggest desert'], answer: 'Antarctic Desert', aliases: ['antarctic', 'antarctic desert', 'sahara'], explanation: 'The Antarctic Polar Desert is the largest desert on Earth; the Sahara is the largest hot desert.', category: 'Geography' },
  { triggers: ['longest river'], answer: 'Nile', aliases: ['nile', 'amazon'], explanation: 'The Nile is traditionally cited as the longest river (the Amazon carries the most water).', category: 'Geography' },
  { triggers: ['largest ocean', 'biggest ocean'], answer: 'Pacific', aliases: ['pacific', 'pacific ocean'], explanation: 'The Pacific Ocean is the largest and deepest ocean.', category: 'Geography' },
  { triggers: ['highest mountain', 'tallest mountain'], answer: 'Everest', aliases: ['everest', 'mount everest', 'sagarmatha'], explanation: 'Mount Everest (8,849 m) is the tallest mountain above sea level.', category: 'Geography' },
  { triggers: ['largest country', 'biggest country'], answer: 'Russia', aliases: ['russia'], explanation: 'Russia is the largest country by land area.', category: 'Geography' },
  { triggers: ['smallest continent'], answer: 'Australia', aliases: ['australia'], explanation: 'Australia is the smallest continent.', category: 'Geography' },

  // ---- Science ----
  { triggers: ['chemical symbol for water', 'formula for water'], answer: 'H2O', aliases: ['h2o', 'h₂o'], explanation: 'Water is two hydrogen atoms bonded to one oxygen atom: H₂O.', category: 'Science' },
  { triggers: ['chemical symbol for gold'], answer: 'Au', aliases: ['au'], explanation: 'Gold’s symbol Au comes from the Latin “aurum”.', category: 'Science' },
  { triggers: ['chemical symbol for silver'], answer: 'Ag', aliases: ['ag'], explanation: 'Silver’s symbol Ag comes from the Latin “argentum”.', category: 'Science' },
  { triggers: ['chemical symbol for iron'], answer: 'Fe', aliases: ['fe'], explanation: 'Iron’s symbol Fe comes from the Latin “ferrum”.', category: 'Science' },
  { triggers: ['chemical symbol for sodium'], answer: 'Na', aliases: ['na'], explanation: 'Sodium’s symbol Na comes from “natrium”.', category: 'Science' },
  { triggers: ['chemical symbol for oxygen'], answer: 'O', aliases: ['o', 'oxygen'], explanation: 'Oxygen’s chemical symbol is O.', category: 'Science' },
  { triggers: ['gas plants absorb', 'photosynthesis uses'], answer: 'Carbon dioxide', aliases: ['carbon dioxide', 'co2'], explanation: 'Plants absorb carbon dioxide (CO₂) for photosynthesis.', category: 'Science' },
  { triggers: ['gas humans need to breathe', 'gas we breathe'], answer: 'Oxygen', aliases: ['oxygen', 'o2'], explanation: 'Humans need oxygen for cellular respiration.', category: 'Science' },
  { triggers: ['planet closest to the sun', 'closest planet to the sun'], answer: 'Mercury', aliases: ['mercury'], explanation: 'Mercury orbits closest to the Sun.', category: 'Science' },
  { triggers: ['red planet'], answer: 'Mars', aliases: ['mars'], explanation: 'Mars is called the Red Planet due to iron oxide on its surface.', category: 'Science' },
  { triggers: ['largest planet'], answer: 'Jupiter', aliases: ['jupiter'], explanation: 'Jupiter is the largest planet in the Solar System.', category: 'Science' },
  { triggers: ['planet with rings', 'ringed planet'], answer: 'Saturn', aliases: ['saturn'], explanation: 'Saturn is famous for its prominent ring system.', category: 'Science' },
  { triggers: ['force that pulls objects', 'force of gravity', 'who discovered gravity'], answer: 'Gravity', aliases: ['gravity', 'newton'], explanation: 'Gravity is the force attracting masses; Newton formulated the law of universal gravitation.', category: 'Science' },
  { triggers: ['speed of light'], answer: '300,000 km/s', aliases: ['300000', '299792', '3e8', '300,000 km/s'], explanation: 'Light travels at ≈299,792 km/s in vacuum.', category: 'Science' },
  { triggers: ['boiling point of water'], answer: '100', aliases: ['100', '100°c', '100c', '212'], explanation: 'Water boils at 100 °C (212 °F) at sea level.', category: 'Science' },
  { triggers: ['freezing point of water'], answer: '0', aliases: ['0', '0°c', '0c', '32'], explanation: 'Water freezes at 0 °C (32 °F) at sea level.', category: 'Science' },
  { triggers: ['how many bones', 'bones in human body'], answer: '206', aliases: ['206'], explanation: 'An adult human skeleton has 206 bones.', category: 'Science' },
  { triggers: ['powerhouse of the cell'], answer: 'Mitochondria', aliases: ['mitochondria', 'mitochondrion'], explanation: 'Mitochondria generate ATP — the cell’s energy currency.', category: 'Science' },
  { triggers: ['dna shape', 'structure of dna'], answer: 'Double helix', aliases: ['double helix', 'helix'], explanation: 'DNA has a double-helix structure (Watson, Crick, Franklin).', category: 'Science' },
  { triggers: ['center of the solar system', 'sun is a'], answer: 'Sun', aliases: ['sun', 'star'], explanation: 'The Sun is the star at the center of our Solar System.', category: 'Science' },

  // ---- Math facts ----
  { triggers: ['value of pi'], answer: '3.14', aliases: ['3.14', '3.14159'], explanation: 'π ≈ 3.14159…', category: 'Math' },
  { triggers: ['square root of 144'], answer: '12', aliases: ['12'], explanation: '√144 = 12 because 12 × 12 = 144.', category: 'Math' },
  { triggers: ['square root of 169'], answer: '13', aliases: ['13'], explanation: '√169 = 13 because 13 × 13 = 169.', category: 'Math' },
  { triggers: ['square root of 81'], answer: '9', aliases: ['9'], explanation: '√81 = 9 because 9 × 9 = 81.', category: 'Math' },
  { triggers: ['square root of 64'], answer: '8', aliases: ['8'], explanation: '√64 = 8 because 8 × 8 = 64.', category: 'Math' },
  { triggers: ['how many sides does a triangle'], answer: '3', aliases: ['3', 'three'], explanation: 'A triangle has 3 sides.', category: 'Math' },
  { triggers: ['how many sides does a hexagon'], answer: '6', aliases: ['6', 'six'], explanation: 'A hexagon has 6 sides.', category: 'Math' },
  { triggers: ['how many sides does an octagon'], answer: '8', aliases: ['8', 'eight'], explanation: 'An octagon has 8 sides.', category: 'Math' },
  { triggers: ['degrees in a circle'], answer: '360', aliases: ['360'], explanation: 'A full circle spans 360 degrees.', category: 'Math' },
  { triggers: ['degrees in a triangle'], answer: '180', aliases: ['180'], explanation: 'Interior angles of a triangle sum to 180°.', category: 'Math' },

  // ---- Technology ----
  { triggers: ['what does cpu stand for'], answer: 'Central Processing Unit', aliases: ['central processing unit', 'cpu'], explanation: 'CPU = Central Processing Unit.', category: 'Technology' },
  { triggers: ['what does ram stand for'], answer: 'Random Access Memory', aliases: ['random access memory', 'ram'], explanation: 'RAM = Random Access Memory.', category: 'Technology' },
  { triggers: ['what does html stand for'], answer: 'HyperText Markup Language', aliases: ['hypertext markup language', 'html'], explanation: 'HTML = HyperText Markup Language.', category: 'Technology' },
  { triggers: ['what does ai stand for'], answer: 'Artificial Intelligence', aliases: ['artificial intelligence'], explanation: 'AI = Artificial Intelligence.', category: 'Technology' },
  { triggers: ['founded microsoft', 'founder of microsoft'], answer: 'Bill Gates', aliases: ['bill gates', 'gates'], explanation: 'Microsoft was co-founded by Bill Gates and Paul Allen.', category: 'Technology' },
  { triggers: ['founded apple', 'founder of apple'], answer: 'Steve Jobs', aliases: ['steve jobs', 'jobs'], explanation: 'Apple was co-founded by Steve Jobs, Steve Wozniak and Ronald Wayne.', category: 'Technology' },
  { triggers: ['binary of', 'binary number system base'], answer: '2', aliases: ['2', 'two', 'base 2'], explanation: 'Binary is base-2: digits 0 and 1.', category: 'Technology' },
  { triggers: ['how many bits in a byte'], answer: '8', aliases: ['8', 'eight'], explanation: 'One byte = 8 bits.', category: 'Technology' },
  { triggers: ['language of the web', 'runs in the browser'], answer: 'JavaScript', aliases: ['javascript', 'js', 'typescript'], explanation: 'JavaScript is the programming language of the web browser.', category: 'Technology' },

  // ---- History & culture ----
  { triggers: ['first man on the moon', 'first person on the moon'], answer: 'Neil Armstrong', aliases: ['neil armstrong', 'armstrong'], explanation: 'Neil Armstrong stepped onto the Moon on July 20, 1969 (Apollo 11).', category: 'History' },
  { triggers: ['year world war ii ended', 'when did ww2 end', 'when did world war 2 end'], answer: '1945', aliases: ['1945'], explanation: 'World War II ended in 1945.', category: 'History' },
  { triggers: ['first president of the usa', 'first us president'], answer: 'George Washington', aliases: ['george washington', 'washington'], explanation: 'George Washington was the first U.S. president (1789).', category: 'History' },
  { triggers: ['wrote romeo and juliet', 'wrote hamlet'], answer: 'Shakespeare', aliases: ['shakespeare', 'william shakespeare'], explanation: 'William Shakespeare wrote Romeo and Juliet and Hamlet.', category: 'History' },
  { triggers: ['painted the mona lisa'], answer: 'Leonardo da Vinci', aliases: ['leonardo da vinci', 'da vinci', 'leonardo'], explanation: 'Leonardo da Vinci painted the Mona Lisa.', category: 'History' },
  { triggers: ['ancient egyptian writing'], answer: 'Hieroglyphs', aliases: ['hieroglyphs', 'hieroglyphics'], explanation: 'Ancient Egyptians wrote in hieroglyphs.', category: 'History' },
  { triggers: ['olympic games originated', 'olympics began'], answer: 'Greece', aliases: ['greece', 'olympia'], explanation: 'The Olympic Games originated in ancient Greece (Olympia, 776 BC).', category: 'History' },
  { triggers: ['how many players on a football team', 'soccer team players'], answer: '11', aliases: ['11', 'eleven'], explanation: 'A football (soccer) team fields 11 players.', category: 'Sports' },
  { triggers: ['how many rings on the olympic flag'], answer: '5', aliases: ['5', 'five'], explanation: 'The Olympic flag has 5 interlocking rings.', category: 'Sports' },
];
