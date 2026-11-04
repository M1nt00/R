import Phaser from 'phaser';
import type { RoomScene } from '../scenes/RoomScene';
import { ENEMY_KINDS, type EnemyKind } from '../entities/enemy';
import { ELEMENTS, type Element } from '../element/types';
import { ELEMENT_COLOR } from '../art/palette';

const SCRIPTED: EnemyKind[][] = [
  ['charger', 'charger', 'charger'],
  ['charger', 'charger', 'shooter', 'shooter'],
  ['charger', 'shooter', 'bomber', 'bomber', 'charger'],
];

/**
 * 3단계(방 연결·보상) 전까지 쓰는 웨이브 진행.
 * 원소가 골고루 섞이게 뽑아서, 어떤 원소 적이 섞여 있느냐에 따라 판단이 달라지게.
 */
export class WaveDirector {
  wave = 0;
  private pending = 0;
  private active = false;
  private breakT = 0;

  constructor(private readonly s: RoomScene) {}

  start(): void {
    this.breakT = 0.6;
    this.active = false;
  }

  update(dt: number): void {
    if (this.s.player.dead) return;
    if (this.active) {
      if (this.pending === 0 && this.s.enemies.every((e) => e.dead)) {
        this.active = false;
        this.breakT = 2;
        this.s.banner(`WAVE ${this.wave} 클리어`, 0x9fe8a8);
      }
      return;
    }
    this.breakT -= dt;
    if (this.breakT <= 0) this.spawnWave();
  }

  private spawnWave(): void {
    this.wave++;
    this.active = true;
    const list: EnemyKind[] =
      this.wave <= SCRIPTED.length
        ? SCRIPTED[this.wave - 1]
        : Array.from({ length: Math.min(4 + this.wave, 11) }, () => Phaser.Utils.Array.GetRandom(ENEMY_KINDS));
    const pool: Element[] = [];
    while (pool.length < list.length) pool.push(...Phaser.Utils.Array.Shuffle([...ELEMENTS]));

    this.s.banner(`WAVE ${this.wave}`, 0xffffff);
    list.forEach((kind, i) => {
      const el = pool[i];
      const pos = this.s.randomSpawnPoint();
      const delay = 0.8 + i * 0.15;
      this.pending++;
      this.s.vfx.telegraph(pos.x, pos.y, 10, ELEMENT_COLOR[el], delay);
      this.s.scheduler.after(delay, () => {
        this.pending--;
        if (!this.s.player.dead) this.s.spawnEnemy(kind, el, pos.x, pos.y);
      });
    });
  }
}
