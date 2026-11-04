import Phaser from 'phaser';
import { VIEW_W, VIEW_H, RENDER_SCALE, TILE, COLS, ROWS } from '../config';
import { Terrain } from '../element/terrain';
import { ReactionEngine } from '../element/reactionEngine';
import { DATA, colorOf } from '../element/data';
import type { Element, Team } from '../element/types';
import { Combat } from '../combat/damage';
import { Vfx } from '../combat/vfx';
import { Hitstop, Scheduler } from '../combat/hitstop';
import { FieldSystem } from '../combat/fields';
import { ProjectileSystem } from '../combat/projectiles';
import { Player } from '../entities/player';
import { Enemy, type EnemyKind } from '../entities/enemy';
import type { Actor } from '../entities/actor';
import { WaveDirector } from '../run/waves';
import { TEST_ROOM } from '../run/roomLayout';
import { playSfx } from '../audio/sfx';

const CHANNEL_PUSH = 70;

export interface RunStats {
  kills: number;
  reactions: number;
  perfectDodges: number;
  byReaction: Record<string, number>;
}

export class RoomScene extends Phaser.Scene {
  player!: Player;
  enemies: Enemy[] = [];
  terrain!: Terrain;
  engine!: ReactionEngine;
  combat!: Combat;
  vfx!: Vfx;
  fields!: FieldSystem;
  projectiles!: ProjectileSystem;
  scheduler!: Scheduler;
  hitstop!: Hitstop;
  waves!: WaveDirector;
  stats!: RunStats;
  gameTime = 0;
  state: 'intro' | 'playing' | 'dead' = 'intro';

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private playerGroup!: Phaser.Physics.Arcade.Group;
  private enemyGroup!: Phaser.Physics.Arcade.Group;

  constructor() {
    super('Room');
  }

  create(): void {
    // scene.restart() 시 같은 인스턴스를 재사용하므로 상태를 전부 여기서 초기화
    this.gameTime = 0;
    this.state = 'intro';
    this.enemies = [];
    this.stats = { kills: 0, reactions: 0, perfectDodges: 0, byReaction: {} };

    this.cameras.main.setZoom(RENDER_SCALE).centerOn(VIEW_W / 2, VIEW_H / 2).setRoundPixels(true);
    this.physics.world.setBounds(0, 0, VIEW_W, VIEW_H);
    this.input.mouse?.disableContextMenu();

    this.scheduler = new Scheduler();
    this.hitstop = new Hitstop();
    this.vfx = new Vfx(this);
    this.terrain = new Terrain(this, TEST_ROOM);
    this.combat = new Combat(this);
    this.engine = new ReactionEngine(this);
    this.engine.secondaryUnlocked = this.registry.get('secondaryUnlocked') === true;
    this.fields = new FieldSystem(this);
    this.projectiles = new ProjectileSystem(this);

    this.walls = this.physics.add.staticGroup();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.terrain.base[this.terrain.idx(c, r)] !== 'wall') continue;
        const w = this.walls.create(c * TILE + TILE / 2, r * TILE + TILE / 2, 'px') as Phaser.Physics.Arcade.Sprite;
        w.setVisible(false).setDisplaySize(TILE, TILE).refreshBody();
      }
    }
    this.playerGroup = this.physics.add.group();
    this.enemyGroup = this.physics.add.group();
    this.physics.add.collider(this.playerGroup, this.walls);
    this.physics.add.collider(this.enemyGroup, this.walls);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);

    this.player = new Player(this, this.playerGroup, VIEW_W / 2, 184);
    this.waves = new WaveDirector(this);

    if (this.registry.get('started') === true) this.startRun();
  }

  startRun(): void {
    if (this.state !== 'intro') return;
    this.state = 'playing';
    this.registry.set('started', true);
    this.waves.start();
  }

  setSecondaryUnlocked(v: boolean): void {
    this.registry.set('secondaryUnlocked', v);
    this.engine.secondaryUnlocked = v;
  }

  update(_time: number, delta: number): void {
    const realDt = Math.min(delta / 1000, 1 / 20);
    const stopped = this.hitstop.update(realDt);
    const frozen = stopped || this.state === 'intro';
    this.physics.world.isPaused = frozen;
    this.tweens.timeScale = stopped ? 0 : 1;

    if (!frozen) {
      const dt = realDt;
      this.gameTime += dt;
      this.engine.beginFrame();
      this.scheduler.update(dt);
      this.terrain.update(dt);
      this.fields.update(dt);
      this.applyTerrain(dt);
      this.player.update(dt);
      for (const e of [...this.enemies]) e.update(dt);
      this.projectiles.update(dt);
      this.waves.update(dt);
      this.enemies = this.enemies.filter((e) => !e.dead);
    }

    this.player.syncVisuals();
    for (const e of this.enemies) e.syncVisuals();
    this.terrain.draw(this.gameTime);
    this.fields.draw(this.gameTime);
  }

  /** 지형은 플레이어에게도 똑같이 적용된다 */
  private applyTerrain(dt: number): void {
    for (const a of this.actorsOfTeam('all')) {
      const info = this.terrain.infoAt(a.x, a.y);
      a.onIce = info.fx === 'ice';
      if (info.kind === 'channel') a.push.add(new Phaser.Math.Vector2(info.dirX * CHANNEL_PUSH, info.dirY * CHANNEL_PUSH));
      a.terrainTickT -= dt;
      if (a.terrainTickT > 0) continue;
      a.terrainTickT = 0.5;
      const tfx = info.fx !== 'none' ? DATA.terrainEffects[info.fx] : undefined;
      if (tfx) {
        this.combat.hit(a, {
          damage: tfx.damage,
          element: tfx.attach,
          noStack: true,
          attachDuration: 1.5,
          environmental: true,
          color: colorOf(tfx.color),
        });
      } else if (info.kind === 'puddle' && info.fx === 'none') {
        // 물웅덩이에 서 있으면 물이 묻는다
        this.engine.apply(a, 'water', { noStack: true, attachDuration: 1.5 });
      }
    }
  }

  actorsOfTeam(team: Team | 'all'): Actor[] {
    const live = this.enemies.filter((e) => !e.dead);
    const p = this.player && !this.player.dead ? [this.player] : [];
    if (team === 'player') return p;
    if (team === 'enemy') return live;
    return [...p, ...live];
  }

  pointerWorld(): Phaser.Math.Vector2 {
    const p = this.input.activePointer;
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }

  spawnEnemy(kind: EnemyKind, el: Element, x: number, y: number): Enemy {
    const e = new Enemy(this, this.enemyGroup, kind, el, x, y);
    this.enemies.push(e);
    this.vfx.ring(x, y, 2, 16, 0xffffff, 0.25);
    playSfx('spawn');
    return e;
  }

  randomSpawnPoint(): { x: number; y: number } {
    for (let k = 0; k < 80; k++) {
      const c = Phaser.Math.Between(1, COLS - 2);
      const r = Phaser.Math.Between(1, ROWS - 2);
      const kind = this.terrain.kindAt(this.terrain.idx(c, r));
      if (kind === 'wall' || kind === 'channel') continue;
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 100) continue;
      return { x, y };
    }
    return { x: 40, y: 40 };
  }

  shake(dur: number, intensity: number): void {
    this.cameras.main.shake(dur * 1000, intensity);
  }

  banner(text: string, color: number): void {
    this.game.events.emit('banner', text, color);
  }

  onPlayerDeath(): void {
    this.state = 'dead';
    this.shake(0.3, 0.01);
    this.game.events.emit('playerDead');
  }
}
