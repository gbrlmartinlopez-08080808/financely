// The United States, state by state, for the midterm elections hub. Presidential margins are in points (positive = Democratic,
// negative = Republican), rounded. The Senate and governor lists are the incumbents as compiled in early 2026; the candidates
// themselves are read live from Wikipedia on each race page, because they change with every primary.
export type Party = 'D' | 'R' | 'I';
export interface Race {
  inc: string;
  p: Party;
  /** nobody is defending the seat (retiring, term-limited, running for something else) */
  open?: boolean;
  /** a special election for the rest of a term */
  special?: boolean;
}
export interface State {
  code: string;
  name: string;
  /** electoral votes (2024 and 2028) */
  ev: number;
  /** presidential margin 2020 and 2024 */
  m20: number;
  m24: number;
  sen?: Race;
  gov?: Race;
}
const S = (code: string, name: string, ev: number, m20: number, m24: number, sen?: Race, gov?: Race): State => ({ code, name, ev, m20, m24, sen, gov });
const r = (inc: string, p: Party, o: { open?: boolean; special?: boolean } = {}): Race => ({ inc, p, ...o });

export const STATES: State[] = [
  S('AL', 'Alabama', 9, -25.5, -30, r('Tommy Tuberville', 'R', { open: true }), r('Kay Ivey', 'R', { open: true })),
  S('AK', 'Alaska', 3, -10, -13, r('Dan Sullivan', 'R'), r('Mike Dunleavy', 'R', { open: true })),
  S('AZ', 'Arizona', 11, 0.3, -5.5, undefined, r('Katie Hobbs', 'D')),
  S('AR', 'Arkansas', 6, -27.6, -31, r('Tom Cotton', 'R'), r('Sarah Huckabee Sanders', 'R')),
  S('CA', 'California', 54, 29, 20, undefined, r('Gavin Newsom', 'D', { open: true })),
  S('CO', 'Colorado', 10, 13.5, 11, r('John Hickenlooper', 'D'), r('Jared Polis', 'D', { open: true })),
  S('CT', 'Connecticut', 7, 20, 14, undefined, r('Ned Lamont', 'D')),
  S('DE', 'Delaware', 3, 19, 14, r('Chris Coons', 'D')),
  S('DC', 'District of Columbia', 3, 87, 84),
  S('FL', 'Florida', 30, -3.4, -13, r('Ashley Moody', 'R', { special: true }), r('Ron DeSantis', 'R', { open: true })),
  S('GA', 'Georgia', 16, 0.2, -2, r('Jon Ossoff', 'D'), r('Brian Kemp', 'R', { open: true })),
  S('HI', 'Hawaii', 4, 29, 25, undefined, r('Josh Green', 'D')),
  S('ID', 'Idaho', 4, -30.8, -36, r('Jim Risch', 'R'), r('Brad Little', 'R')),
  S('IL', 'Illinois', 19, 17, 11, r('Dick Durbin', 'D', { open: true }), r('JB Pritzker', 'D')),
  S('IN', 'Indiana', 11, -16, -19),
  S('IA', 'Iowa', 6, -8.2, -13, r('Joni Ernst', 'R', { open: true }), r('Kim Reynolds', 'R', { open: true })),
  S('KS', 'Kansas', 6, -14.6, -16, r('Roger Marshall', 'R'), r('Laura Kelly', 'D', { open: true })),
  S('KY', 'Kentucky', 8, -25.9, -30, r('Mitch McConnell', 'R', { open: true })),
  S('LA', 'Louisiana', 8, -18.6, -22, r('Bill Cassidy', 'R')),
  S('ME', 'Maine', 4, 9, 7, r('Susan Collins', 'R'), r('Janet Mills', 'D', { open: true })),
  S('MD', 'Maryland', 10, 33, 29, undefined, r('Wes Moore', 'D')),
  S('MA', 'Massachusetts', 11, 33, 25, r('Ed Markey', 'D'), r('Maura Healey', 'D')),
  S('MI', 'Michigan', 15, 2.8, -1.4, r('Gary Peters', 'D', { open: true }), r('Gretchen Whitmer', 'D', { open: true })),
  S('MN', 'Minnesota', 10, 7.1, 4, r('Tina Smith', 'D', { open: true }), r('Tim Walz', 'D', { open: true })),
  S('MS', 'Mississippi', 6, -16.5, -18, r('Cindy Hyde-Smith', 'R')),
  S('MO', 'Missouri', 10, -15.4, -18),
  S('MT', 'Montana', 4, -16.4, -20, r('Steve Daines', 'R')),
  S('NE', 'Nebraska', 5, -19, -20, r('Pete Ricketts', 'R'), r('Jim Pillen', 'R')),
  S('NV', 'Nevada', 6, 2.4, -3, undefined, r('Joe Lombardo', 'R')),
  S('NH', 'New Hampshire', 4, 7, 3, r('Jeanne Shaheen', 'D', { open: true }), r('Kelly Ayotte', 'R')),
  S('NJ', 'New Jersey', 14, 16, 6, r('Cory Booker', 'D')),
  S('NM', 'New Mexico', 5, 10.8, 6, r('Ben Ray Luján', 'D'), r('Michelle Lujan Grisham', 'D', { open: true })),
  S('NY', 'New York', 28, 23, 13, undefined, r('Kathy Hochul', 'D')),
  S('NC', 'North Carolina', 16, -1.3, -3, r('Thom Tillis', 'R', { open: true })),
  S('ND', 'North Dakota', 3, -33, -36),
  S('OH', 'Ohio', 17, -8, -11, r('Jon Husted', 'R', { special: true }), r('Mike DeWine', 'R', { open: true })),
  S('OK', 'Oklahoma', 7, -33, -34, r('Markwayne Mullin', 'R'), r('Kevin Stitt', 'R', { open: true })),
  S('OR', 'Oregon', 8, 16, 14, r('Jeff Merkley', 'D'), r('Tina Kotek', 'D')),
  S('PA', 'Pennsylvania', 19, 1.2, -1.7, undefined, r('Josh Shapiro', 'D')),
  S('RI', 'Rhode Island', 4, 20.8, 14, r('Jack Reed', 'D'), r('Dan McKee', 'D')),
  S('SC', 'South Carolina', 9, -11.7, -18, r('Lindsey Graham', 'R'), r('Henry McMaster', 'R', { open: true })),
  S('SD', 'South Dakota', 3, -26, -29, r('Mike Rounds', 'R'), r('Larry Rhoden', 'R')),
  S('TN', 'Tennessee', 11, -23.2, -30, r('Bill Hagerty', 'R'), r('Bill Lee', 'R', { open: true })),
  S('TX', 'Texas', 40, -5.6, -14, r('John Cornyn', 'R'), r('Greg Abbott', 'R')),
  S('UT', 'Utah', 6, -20.5, -21),
  S('VT', 'Vermont', 3, 35, 31, undefined, r('Phil Scott', 'R')),
  S('VA', 'Virginia', 13, 10.1, 6, r('Mark Warner', 'D')),
  S('WA', 'Washington', 12, 19, 18),
  S('WV', 'West Virginia', 4, -38.9, -42, r('Shelley Moore Capito', 'R')),
  S('WI', 'Wisconsin', 10, 0.6, -0.9, undefined, r('Tony Evers', 'D', { open: true })),
  S('WY', 'Wyoming', 3, -43.4, -46, r('Cynthia Lummis', 'R', { open: true }), r('Mark Gordon', 'R', { open: true })),
];
export const byCode = (c: string) => STATES.find((s) => s.code === c)!;
/** House seats: the electoral votes less the two senators (the District has none) */
export const houseSeats = (s: State) => (s.code === 'DC' ? 1 : s.ev - 2);
/** the square-tile map that gives every state the same room: [row, column] */
export const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], RI: [2, 9], MA: [2, 10],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 8],
};
export const racePages = (s: State) => ({
  senate: `2026 United States Senate election in ${s.name}`,
  gov: `2026 ${s.name} gubernatorial election`,
  house: `2026 United States House of Representatives elections in ${s.name}`,
});
