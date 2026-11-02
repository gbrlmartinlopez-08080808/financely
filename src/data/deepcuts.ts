// "Deep cuts": prompts with many right answers. An answer is worth more the less familiar it is — how rarely the name turns up in
// what people read and write. Each list below runs from the most familiar answer to the rarest one; the position in the list is
// the rank, and the score follows Zipf's law (the common answers are crowded at the top, the rare ones trail off in a long tail).
// Variants of a name are given after "|".
export interface Prompt {
  id: string;
  q: string;
  /** most familiar first */
  a: string[];
}
const L = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export const PROMPTS: Prompt[] = [
  {
    id: 'africa',
    q: 'Name a country in Africa',
    a: L('Egypt, South Africa|S Africa, Nigeria, Kenya, Morocco, Ethiopia, Ghana, Algeria, Tanzania, Libya, Tunisia, Uganda, Senegal, Sudan, Zimbabwe, Angola, Mozambique, Zambia, Cameroon, Ivory Coast|Cote d\'Ivoire, Madagascar, Namibia, Botswana, Rwanda, Mali, Somalia, Congo|DR Congo, Chad, Niger, Malawi, Mauritius, Gabon, Benin, Togo, Liberia, Sierra Leone, Eritrea, Djibouti, Lesotho, Eswatini|Swaziland, Burundi, Gambia, Mauritania, Seychelles, Comoros, Cape Verde|Cabo Verde, Guinea-Bissau, Equatorial Guinea, South Sudan, Burkina Faso, Central African Republic, Sao Tome and Principe'),
  },
  {
    id: 'element',
    q: 'Name a chemical element',
    a: L('Oxygen, Hydrogen, Carbon, Gold, Iron, Helium, Nitrogen, Silver, Copper, Sodium, Calcium, Lead, Uranium, Zinc, Neon, Mercury, Tin, Chlorine, Silicon, Sulfur|Sulphur, Phosphorus, Potassium, Aluminium|Aluminum, Magnesium, Titanium, Platinum, Nickel, Lithium, Argon, Iodine, Cobalt, Chromium, Manganese, Tungsten, Arsenic, Plutonium, Radium, Krypton, Xenon, Bromine, Boron, Fluorine, Barium, Cadmium, Antimony, Bismuth, Gallium, Germanium, Selenium, Strontium, Zirconium, Iridium, Osmium, Palladium, Rhodium, Thorium, Vanadium, Rubidium, Caesium|Cesium, Tellurium, Yttrium, Scandium, Niobium, Tantalum, Hafnium, Rhenium, Ruthenium, Indium, Thallium, Polonium, Francium, Astatine, Radon, Neodymium, Cerium, Lanthanum, Europium, Erbium, Holmium, Thulium, Lutetium, Praseodymium, Samarium, Gadolinium, Terbium, Dysprosium, Ytterbium, Technetium, Molybdenum, Protactinium'),
  },
  {
    id: 'painter',
    q: 'Name a famous painter',
    a: L('Picasso, Van Gogh, Leonardo da Vinci|Da Vinci|Leonardo, Monet, Rembrandt, Michelangelo, Dali, Warhol, Rubens, Raphael, Matisse, Cezanne, Renoir, Munch, Klimt, Goya, Vermeer, Degas, Turner, Hokusai, Botticelli, Caravaggio, Frida Kahlo|Kahlo, Pollock, Rothko, Manet, Gauguin, Magritte, Kandinsky, Mondrian, Titian, El Greco, Velazquez, Constable, Seurat, Bosch, Bruegel, Chagall, Hopper, Basquiat, Modigliani, Miro, Canaletto, Giotto, Fra Angelico, Delacroix, Courbet, Whistler, Sargent, Georgia O\'Keeffe|O\'Keeffe, Hockney, Francis Bacon, Lucian Freud|Freud, Frans Hals|Hals, Tintoretto, Veronese, Poussin, Watteau, Fragonard, Ingres, Gericault, Pissarro, Sisley, Toulouse-Lautrec, Redon, Schiele, Kirchner, Klee, Leger, Arcimboldo, Artemisia Gentileschi|Gentileschi, Hilma af Klint, Vigee Le Brun, Zurbaran, Murillo, Mantegna, Piero della Francesca, Uccello, Lorenzo Lotto|Lotto, Memling, Van Eyck, Durer, Holbein, Cranach, Friedrich, Bonnard, Vuillard, Redon, Balthus, Morandi, Sorolla, Zorn, Hammershoi, Rousseau, Ensor, Kupka'),
  },
  {
    id: 'river',
    q: 'Name a river',
    a: L('Nile, Amazon, Mississippi, Thames, Danube, Rhine, Yangtze, Ganges, Seine, Volga, Congo, Missouri, Colorado, Tigris, Euphrates, Mekong, Indus, Hudson, Rhone, Tiber, Elbe, Loire, Ebro, Tagus, Po, Oder, Vistula, Dnieper, Don, Ob, Lena, Yenisei, Amur, Orinoco, Parana, Murray, Zambezi, Niger, Limpopo, Orange, Irrawaddy, Brahmaputra, Yukon, Mackenzie, St Lawrence|Saint Lawrence, Rio Grande, Shannon, Severn, Trent, Tyne, Clyde, Meuse, Moselle, Main, Weser, Inn, Drava, Sava, Tisza, Dniester, Neva, Kama, Oka, Syr Darya, Amu Darya, Jordan, Orontes, Salween, Chao Phraya, Yellow River|Huang He, Pearl River, Darling, Magdalena, Sao Francisco, Paraguay, Uruguay, Fraser, Columbia, Ohio, Tennessee, Arkansas, Snake, Potomac, Delaware, Susquehanna, Churchill, Nelson, Saskatchewan, Athabasca, Peace, Liard'),
  },
  {
    id: 'shakespeare',
    q: 'Name a play by Shakespeare',
    a: L('Hamlet, Macbeth, Romeo and Juliet|Romeo & Juliet, Othello, King Lear|Lear, A Midsummer Night\'s Dream|Midsummer Night\'s Dream, The Tempest|Tempest, Julius Caesar, Twelfth Night, Much Ado About Nothing, The Merchant of Venice|Merchant of Venice, As You Like It, Richard III, Henry V, Antony and Cleopatra, Coriolanus, Titus Andronicus, The Taming of the Shrew|Taming of the Shrew, The Winter\'s Tale|Winter\'s Tale, Measure for Measure, Cymbeline, Timon of Athens, Troilus and Cressida, All\'s Well That Ends Well, Pericles, The Comedy of Errors|Comedy of Errors, Love\'s Labour\'s Lost, The Two Gentlemen of Verona|Two Gentlemen of Verona, Richard II, Henry IV, Henry VI, King John, Henry VIII, The Merry Wives of Windsor|Merry Wives of Windsor, The Two Noble Kinsmen|Two Noble Kinsmen, Edward III'),
  },
  {
    id: 'mammal',
    q: 'Name a mammal',
    a: L('Dog, Cat, Elephant, Lion, Tiger, Horse, Whale, Dolphin, Bear, Monkey, Giraffe, Zebra, Kangaroo, Wolf, Fox, Rabbit, Deer, Cow, Pig, Sheep, Bat, Gorilla, Hippopotamus|Hippo, Rhinoceros|Rhino, Leopard, Cheetah, Panda, Koala, Otter, Seal, Walrus, Camel, Squirrel, Mouse, Rat, Hedgehog, Badger, Beaver, Platypus, Armadillo, Sloth, Anteater, Pangolin, Aardvark, Meerkat, Lemur, Tapir, Okapi, Narwhal, Manatee, Wombat, Tasmanian devil, Quokka, Capybara, Chinchilla, Mongoose, Wolverine, Echidna, Dugong, Binturong, Fossa, Numbat, Saiga, Aye-aye, Solenodon, Shrew, Vole, Pika, Kinkajou, Coati, Civet, Genet, Dik-dik, Gerenuk, Kudu, Bongo, Babirusa, Muntjac, Tenrec, Hyrax, Colugo, Gundi, Desman, Potoroo, Bilby, Bandicoot'),
  },
  {
    id: 'instrument',
    q: 'Name a musical instrument',
    a: L('Piano, Guitar, Violin, Drums|Drum, Flute, Trumpet, Saxophone, Cello, Clarinet, Harp, Trombone, Organ, Accordion, Banjo, Harmonica, Oboe, Bassoon, Tuba, Ukulele, Xylophone, Bagpipes, Mandolin, Double bass, Viola, French horn, Piccolo, Tambourine, Triangle, Cymbals, Timpani, Sitar, Harpsichord, Recorder, Cornet, Lute, Balalaika, Didgeridoo, Theremin, Zither, Dulcimer, Marimba, Glockenspiel, Bouzouki, Koto, Shamisen, Oud, Tabla, Erhu, Kalimba, Hurdy-gurdy, Sackbut, Serpent, Ocarina, Pan flute, Celesta, Vibraphone, Cor anglais, Contrabassoon, Sousaphone, Euphonium, Flugelhorn, Charango, Cuatro, Mbira, Djembe, Nyckelharpa, Glass harmonica, Crumhorn, Rebec, Theorbo, Shawm, Cimbalom, Santur, Guzheng, Pipa, Morin khuur'),
  },
  {
    id: 'capital',
    q: 'Name a capital city in Europe',
    a: L('Paris, London, Rome, Berlin, Madrid, Lisbon, Vienna, Athens, Amsterdam, Brussels, Dublin, Stockholm, Oslo, Copenhagen, Helsinki, Warsaw, Prague, Budapest, Bucharest, Sofia, Belgrade, Zagreb, Bern|Berne, Reykjavik, Kyiv|Kiev, Moscow, Minsk, Riga, Tallinn, Vilnius, Ljubljana, Bratislava, Sarajevo, Skopje, Tirana, Podgorica, Valletta, Luxembourg, Monaco, Vaduz, San Marino, Andorra la Vella, Chisinau, Pristina, Nicosia, Torshavn, Douglas, St Helier, Gibraltar'),
  },
  {
    id: 'pasta',
    q: 'Name a type of pasta',
    a: L('Spaghetti, Penne, Lasagne|Lasagna, Macaroni, Fettuccine, Ravioli, Tagliatelle, Linguine, Fusilli, Farfalle, Tortellini, Rigatoni, Gnocchi, Cannelloni, Orzo, Pappardelle, Conchiglie, Orecchiette, Bucatini, Vermicelli, Capellini, Ziti, Rotini, Cavatappi, Tortelloni, Agnolotti, Trofie, Strozzapreti, Paccheri, Casarecce, Gemelli, Ditalini, Anelli, Radiatori, Campanelle, Mafalde, Tagliolini, Maltagliati, Pici, Bigoli, Garganelli, Fregola, Malloreddus, Cappelletti, Mezzelune, Culurgiones, Busiate, Lumache, Fideo, Stelline, Scialatielli, Calamarata, Sagnarelli, Lagane, Cencioni, Testaroli, Cjarsons, Pizzoccheri'),
  },
  {
    id: 'scientist',
    q: 'Name a famous scientist',
    a: L('Einstein, Newton, Darwin, Marie Curie|Curie, Galileo, Tesla, Hawking, Pasteur, Edison, Faraday, Bohr, Feynman, Copernicus, Kepler, Mendel, Maxwell, Fleming, Turing, Franklin, Planck, Heisenberg, Schrodinger, Dirac, Rutherford, Hubble, Sagan, Goodall, Lavoisier, Mendeleev, Boyle, Hooke, Linnaeus, Halley, Euler, Gauss, Fermat, Pascal, Leibniz, Archimedes, Pythagoras, Euclid, Hippocrates, Avicenna, Al-Khwarizmi, Noether, Hertz, Volta, Ampere, Ohm, Joule, Kelvin, Celsius, Fahrenheit, Doppler, Pauli, Fermi, Oppenheimer, Chandrasekhar, Raman, Bose, Ramanujan, Lemaitre, Tombaugh, Lamarck, Cuvier, Wegener, Lyell, Hutton, Priestley, Cavendish, Dalton, Avogadro, Berzelius, Bunsen, Kirchhoff, Becquerel, Rontgen, Meitner, Hahn, Rosalind Franklin, Ibn al-Haytham|Alhazen, Tycho Brahe|Brahe, Cannizzaro, Mach, Boltzmann, Gibbs, Lorentz, Zeeman, Hevesy, Soddy'),
  },
  {
    id: 'composer',
    q: 'Name a famous composer',
    a: L('Mozart, Beethoven, Bach, Chopin, Tchaikovsky, Vivaldi, Handel, Schubert, Brahms, Wagner, Haydn, Debussy, Verdi, Liszt, Mahler, Stravinsky, Rachmaninoff, Dvorak, Grieg, Puccini, Mendelssohn, Schumann, Ravel, Sibelius, Elgar, Holst, Copland, Gershwin, Bernstein, Prokofiev, Shostakovich, Berlioz, Bizet, Rossini, Donizetti, Bellini, Satie, Faure, Saint-Saens, Mussorgsky, Rimsky-Korsakov, Borodin, Smetana, Janacek, Bartok, Kodaly, Britten, Vaughan Williams, Purcell, Monteverdi, Palestrina, Telemann, Scarlatti, Corelli, Albinoni, Pachelbel, Gluck, Paganini, Offenbach, Strauss, Bruckner, Webern, Schoenberg, Berg, Ligeti, Messiaen, Boulez, Stockhausen, Philip Glass|Glass, Steve Reich|Reich, John Adams, Arvo Part|Part, Gorecki, Penderecki, Tallis, Byrd, Dowland, Josquin, Machaut, Perotin, Hildegard of Bingen|Hildegard, Lully, Rameau, Couperin, Buxtehude, Frescobaldi, Gesualdo, Biber, Sweelinck'),
  },
  {
    id: 'poet',
    q: 'Name a famous poet',
    a: L('Wordsworth, Keats, Byron, Shelley, Blake, Dickinson, Whitman, Frost, Poe, Eliot, Yeats, Plath, Neruda, Dante, Homer, Virgil, Milton, Chaucer, Tennyson, Browning, Auden, Larkin, Heaney, Hughes, Angelou, Rilke, Goethe, Pushkin, Baudelaire, Rimbaud, Verlaine, Lorca, Borges, Paz, Tagore, Rumi, Hafez, Basho, Li Bai, Du Fu, Ovid, Horace, Sappho, Pindar, Petrarch, Ginsberg, Pound, Wallace Stevens|Stevens, William Carlos Williams|Williams, E E Cummings|Cummings, Elizabeth Bishop|Bishop, Lowell, Sexton, Merwin, Mary Oliver|Oliver, Szymborska, Milosz, Akhmatova, Mayakovsky, Brodsky, Heine, Holderlin, Novalis, Celan, Apollinaire, Mallarme, Valery, Prevert, Cavafy, Seferis, Ritsos, Walcott, Gwendolyn Brooks|Brooks, Hardy, Housman, Wilfred Owen|Owen, Sassoon, Rupert Brooke, Dylan Thomas, Betjeman, Duffy, Armitage, Anne Carson|Carson, Tsvetaeva, Mandelstam, Pessoa, Camoes, Leopardi, Montale, Ungaretti, Quasimodo'),
  },
  {
    id: 'mountain',
    q: 'Name a mountain',
    a: L('Everest, K2, Kilimanjaro, Mont Blanc, Matterhorn, Denali|McKinley, Fuji, Elbrus, Aconcagua, Kangchenjunga, Lhotse, Makalu, Annapurna, Olympus, Etna, Vesuvius, Ben Nevis, Snowdon, Rushmore, Whitney, Rainier, Hood, St Helens, Table Mountain, Eiger, Jungfrau, Monte Rosa, Triglav, Teide, Ararat, Sinai, Kosciuszko, Cook|Aoraki, Kenya, Stanley, Logan, Elbert, Shasta, Cho Oyu, Nanga Parbat, Dhaulagiri, Manaslu, Gasherbrum, Broad Peak, Vinson, Chimborazo, Cotopaxi, Huascaran, Fitz Roy, Kinabalu, Mauna Kea, Mauna Loa, Popocatepetl, Pico de Orizaba, Zugspitze, Grossglockner, Gran Paradiso, Mulhacen, Aneto, Musala, Ushba, Kazbek, Damavand, Sagarmatha, Tahan, Kerinci, Rinjani, Merapi, Krakatoa, Pinatubo, Mayon, Taranaki, Tongariro, Ruapehu'),
  },
  {
    id: 'dinosaur',
    q: 'Name a dinosaur',
    a: L('Tyrannosaurus|T Rex|Tyrannosaurus Rex, Triceratops, Velociraptor, Stegosaurus, Brachiosaurus, Diplodocus, Allosaurus, Spinosaurus, Ankylosaurus, Iguanodon, Apatosaurus, Brontosaurus, Parasaurolophus, Compsognathus, Megalosaurus, Gallimimus, Giganotosaurus, Carnotaurus, Pachycephalosaurus, Dilophosaurus, Oviraptor, Deinonychus, Utahraptor, Therizinosaurus, Argentinosaurus, Maiasaura, Protoceratops, Baryonyx, Albertosaurus, Edmontosaurus, Coelophysis, Plateosaurus, Camarasaurus, Styracosaurus, Corythosaurus, Mamenchisaurus, Ceratosaurus, Microraptor, Troodon, Hadrosaurus, Psittacosaurus, Gigantoraptor, Kentrosaurus, Dreadnoughtus, Amargasaurus, Sinosauropteryx, Pachyrhinosaurus, Nigersaurus, Concavenator, Qianzhousaurus, Eoraptor, Herrerasaurus, Tarbosaurus, Majungasaurus, Suchomimus, Irritator, Ouranosaurus, Muttaburrasaurus, Leaellynasaura, Minmi, Kosmoceratops, Nasutoceratops, Mapusaurus'),
  },
  {
    id: 'spice',
    q: 'Name a spice or herb',
    a: L('Pepper, Cinnamon, Basil, Oregano, Thyme, Rosemary, Parsley, Mint, Ginger, Garlic, Paprika, Cumin, Turmeric, Nutmeg, Cloves, Vanilla, Saffron, Cardamom, Coriander|Cilantro, Chili|Chilli, Dill, Sage, Bay leaf|Bay, Mustard, Fennel, Tarragon, Chives, Cayenne, Allspice, Star anise, Caraway, Fenugreek, Sumac, Juniper, Lemongrass, Marjoram, Savory, Anise, Asafoetida|Hing, Nigella, Galangal, Mace, Lovage, Borage, Hyssop, Epazote, Annatto, Long pepper, Grains of paradise, Szechuan pepper|Sichuan pepper, Wasabi, Horseradish, Curry leaf, Kaffir lime, Shiso, Perilla, Angelica, Woodruff, Ajwain, Amchur, Kokum, Mahlab, Nigella, Zedoary, Cubeb, Sorrel, Salad burnet, Chervil, Rue'),
  },
  {
    id: 'game',
    q: 'Name a board game or card game',
    a: L('Chess, Monopoly, Scrabble, Poker, Checkers|Draughts, Backgammon, Bridge, Go, Clue|Cluedo, Risk, Uno, Trivial Pursuit, Battleship, Jenga, Blackjack, Dominoes, Mahjong, Othello|Reversi, Connect Four, Snakes and Ladders, Ludo, Pictionary, Catan|Settlers of Catan, Carcassonne, Ticket to Ride, Pandemic, Cribbage, Whist, Hearts, Rummy, Canasta, Solitaire|Patience, Snap, Go Fish, Shogi, Xiangqi, Nine men\'s morris, Mancala, Senet, Hnefatafl, Pachisi, Chinese checkers, Stratego, Diplomacy, Agricola, Dominion, Azul, Splendor, Codenames, Dixit, 7 Wonders|Seven Wonders, Puerto Rico, Terraforming Mars, Gloomhaven, Twilight Struggle, Brass, Caylus, Tigris and Euphrates, Hanabi, Patchwork, Hive, Onitama, Santorini, Quoridor, Abalone, Tak, Yinsh, Gipf'),
  },
];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ')
    .trim();

const lev = (a: string, b: string) => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

export interface Scored {
  /** the answer as listed, or undefined when it is not in the list */
  name?: string;
  rank?: number;
  of: number;
  points: number;
  tier: 'unknown' | 'common' | 'known' | 'uncommon' | 'deep cut' | 'deepest cut';
}

/**
 * Scores an answer. Familiarity falls off with rank the way word frequency does (Zipf): the points grow with the logarithm of
 * the rank, so the first few answers are worth very little and the long tail of rare ones is worth most.
 */
export function scoreAnswer(p: Prompt, raw: string): Scored {
  const n = p.a.length;
  const x = fold(raw);
  if (x.length < 2) return { of: n, points: 0, tier: 'unknown' };
  let best = -1;
  let bestD = 9;
  p.a.forEach((entry, i) => {
    for (const v of entry.split('|')) {
      const f = fold(v);
      const d = f === x ? 0 : f.includes(' ') || f.length < 5 ? (f === x ? 0 : 9) : lev(f, x) <= (f.length >= 8 ? 2 : 1) ? 1 : 9;
      if (d < bestD) (bestD = d), (best = i);
    }
  });
  if (best < 0) return { of: n, points: 0, tier: 'unknown' };
  const rank = best + 1;
  const points = Math.round(3 + (97 * Math.log(rank)) / Math.log(n));
  const tier = points < 25 ? 'common' : points < 50 ? 'known' : points < 75 ? 'uncommon' : points < 92 ? 'deep cut' : 'deepest cut';
  return { name: p.a[best].split('|')[0], rank, of: n, points, tier };
}

/** a few of the rarest valid answers, to show after a round */
export const deepestOf = (p: Prompt, k = 3) => p.a.slice(-k).map((e) => e.split('|')[0]);
