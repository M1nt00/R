import type { UpgradeId } from '../scenes/dustZone';

/**
 * 행성 진행: 구역을 넘어 이어지는 것.
 * - 산소탑 업그레이드 단계는 다음 구역의 산소탑에도 그대로 이어진다 (2026-11-11, 사용자가 정함).
 * 지금은 게임을 켜 둔 동안만 유지한다. 세이브가 생기면 구역 진행과 함께 여기도 저장할 것
 * (업그레이드만 먼저 저장하면 새로고침 뒤 구역은 처음인데 업그레이드만 남아서).
 * 도감은 따로 저장한다 (run/codex.ts).
 */
export const planet = {
  upgrades: { oxy: 0, make: 0, hp: 0 } as Record<UpgradeId, number>,
};
