export type Element = 'fire' | 'water' | 'wind' | 'lightning';
export const ELEMENTS: readonly Element[] = ['fire', 'water', 'wind', 'lightning'];

export type Team = 'player' | 'enemy';
export const otherTeam = (t: Team): Team => (t === 'player' ? 'enemy' : 'player');

export const ELEMENT_NAME: Record<Element, string> = {
  fire: '불',
  water: '물',
  wind: '바람',
  lightning: '번개',
};
