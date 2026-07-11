import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export const db: Database.Database = new Database(join(config.dataDir, 'dogroo.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 그룹 자동 분류 규칙 - 이름·학명에 키워드가 포함되면 해당 그룹 (풀에 없는 종용)
const GROUP_RULES: [RegExp, string][] = [
  [/몬스테라|아단소니|Monstera/i, '몬스테라'],
  [/필로덴드론|Philodendron|Thaumatophyllum/i, '필로덴드론'],
  [/스킨답서스|에피프레넘|포토스|Scindapsus|Epipremnum|Pothos/i, '스킨답서스'],
  [/싱고니움|Syngonium|Arrowhead/i, '싱고니움'],
  [/알로카시아|Alocasia/i, '알로카시아'],
  [/안스리움|Anthurium/i, '안스리움'],
  [/칼라테아|마란타|스트로만테|크테난테|Calathea|Goeppertia|Maranta|Stromanthe|Ctenanthe/i, '칼라테아'],
  [/고무나무|모람|푸미라|짜보|Ficus|Fig/i, '고무나무'],
  [/야자|관음죽|종려|소철|극락조|여인초|파초|[Pp]alm|Chamaedorea|Strelitzia/i, '야자'],
  [/산세베리아|스투키|Sansevieria|Snake [Pp]lant/i, '산세베리아'],
  [/드라세나|행운목|유카|Dracaena|Yucca/i, '드라세나'],
  [/아이비|헤데라|Hedera|Ivy/i, '아이비'],
  [/호야|Hoya/i, '호야'],
  [/페페로미아|필레아|베고니아|피토니아|Peperomia|Pilea|Begonia|Fittonia/i, '페페로미아'],
  [/틸란드시아|립살리스|디시디아|디스키디아|러브체인|녹영|Tillandsia|Rhipsalis|Dischidia|Ceropegia/i, '행잉'],
  [/고사리|아디안텀|박쥐란|아비스|펀\b|Fern|Adiantum|Platycerium|Asplenium/i, '고사리'],
  [/로즈마리|라벤더|바질|민트|타임|세이지|오레가노|레몬밤|율마|유칼립투스|허브|Rosemary|Lavender|Mint|Eucalyptus/i, '허브'],
  [/선인장|에케베리아|하월시아|염좌|세덤|알로에|칼랑코에|리톱스|아가베|유포르비아|아데니움|파키포디움|스테파니아|시조바시스|다육|Cactus|Aloe|Echeveria|Sedum|Adenium/i, '다육·선인장'],
  [/호접란|만천홍|덴드로비움|풍란|난초|Phalaenopsis|Orchid|Dendrobium/i, '난초'],
];

// 스키마 + 식물 풀 적용 (IF NOT EXISTS / ON CONFLICT 기반이라 기동 시마다 실행해도 안전)
export function migrate(): void {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf-8');
  db.exec(schema);
  // 기존 DB에 없는 컬럼 추가
  const speciesCols = db.prepare('PRAGMA table_info(species)').all() as { name: string }[];
  if (!speciesCols.some((c) => c.name === 'name_en')) {
    db.exec('ALTER TABLE species ADD COLUMN name_en TEXT');
  }
  if (!speciesCols.some((c) => c.name === 'group_name')) {
    db.exec('ALTER TABLE species ADD COLUMN group_name TEXT');
  }
  const plantCols = db.prepare('PRAGMA table_info(plants)').all() as { name: string }[];
  if (!plantCols.some((c) => c.name === 'pot_type')) {
    db.exec('ALTER TABLE plants ADD COLUMN pot_type TEXT');
  }

  const pool = readFileSync(new URL('./species-pool.sql', import.meta.url), 'utf-8');
  db.exec(pool);

  // 풀에 없는 종(그루 커스텀·wiki 등)은 키워드 매칭으로 그룹 자동 분류
  const ungrouped = db
    .prepare('SELECT id, name, COALESCE(name_en, \'\') AS name_en FROM species WHERE group_name IS NULL')
    .all() as { id: number; name: string; name_en: string }[];
  const setGroup = db.prepare('UPDATE species SET group_name = ? WHERE id = ?');
  for (const s of ungrouped) {
    const target = `${s.name} ${s.name_en}`;
    const rule = GROUP_RULES.find(([pattern]) => pattern.test(target));
    setGroup.run(rule ? rule[1] : '기타', s.id);
  }
}
