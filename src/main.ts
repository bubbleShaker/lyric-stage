import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import './style.css';

// GSAP のプラグインは使う前に gsap 本体へ登録する。登録することで gsap 側が
// プラグインの存在を知り、tween からその機能を呼べるようになる。
gsap.registerPlugin(SplitText);

const stageText = document.querySelector<HTMLDivElement>('#stage-text');
if (!stageText) throw new Error('#stage-text が見つかりません');

stageText.textContent = 'lyric stage';

// SplitText は元のテキストを 1 文字ずつ <div> に分解してくれる。
// 分解後の要素配列 (split.chars) に対してまとめて gsap.from を掛け、
// stagger で 1 文字ずつ時間をずらすのが「刻む」演出の基本形。
const split = SplitText.create(stageText, { type: 'chars' });

gsap.from(split.chars, {
  opacity: 0,
  yPercent: 60,
  duration: 0.8,
  ease: 'power3.out',
  stagger: 0.06,
});
