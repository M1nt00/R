/**
 * 허수아비 (32×32). 글자 하나 = 픽셀 하나, '.'은 투명.
 * 빛은 왼쪽 위에서.
 */
export const DUMMY_PALETTE: Record<string, string> = {
  o: '#3e2731', // 외곽선
  S: '#e8b796', // 자루 밝음
  s: '#c28569', // 자루 중간
  d: '#b86f50', // 자루 어둠
  D: '#733e39', // 자루 가장 어둠 · 바늘땀 눈
  l: '#b86f50', // 나무 밝음
  w: '#733e39', // 나무 어둠
  y: '#fee761', // 짚 밝음
  Y: '#feae34', // 짚 중간
  r: '#d77643', // 짚 어둠
  R: '#e43b44', // 과녁
  q: '#a22633', // 과녁 어둠
  p: '#ead4aa', // 밧줄 밝음
  P: '#e4a672', // 밧줄 어둠
};

/** 발밑 높이 = 말뚝 맨 아랫줄(0부터 세서 29번) 바로 아래 */
export const DUMMY_FOOT_Y = 30;

export const DUMMY: string[] = [
  '................................',
  '................................',
  '.............oooooo.............',
  '...........ooSSSSssoo...........',
  '..........oSSSSSSsssdo..........',
  '..........oSDSDSSDsDdo..........',
  '..........oSSDSSssDsdo..........',
  '..........oSDSDSsDsDdo..........',
  '..........oSSSSSssssdo..........',
  '..........osSSsssssddo..........',
  '...........oosssddDoo...........',
  '.............oooooo.............',
  '.............oppPPo.............',
  '.y.y.......oooooooooo.......y.y.',
  'yyYYpooooooSSSSSSssddoooooopYYyy',
  'YYyypllllloSSSRRRRssdolllllpyyYY',
  'YYrrPwwwwwoSSRSSSSRsdowwwwwPrrYY',
  'rrYYPooooooSSRSRRSqsdooooooPYYrr',
  '.r.r......oSsRSRqSqsdo......r.r.',
  '..........oSsqSSSsqddo..........',
  '..........osssqqqqsddo..........',
  '..........oppppppPPPPo..........',
  '..........ossssssdddDo..........',
  '...........oooooooooo...........',
  '...........yYollwwoYr...........',
  '............rollwwor............',
  '.............ollwwo.............',
  '.............olwlwo.............',
  '............oollwwoo............',
  '.............oooooo.............',
  '................................',
  '................................',
];
