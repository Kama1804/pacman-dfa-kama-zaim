import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

// ==========================================
//  FORMAL DFA DEFINITION
// ==========================================
const STATES = ["Wandering", "Chasing", "Frightened", "Eaten"];

const TRANSITIONS = {
  "Wandering|SeeP":     "Chasing",
  "Wandering|EatPP":    "Frightened",
  "Wandering|KillP":    "Wandering",
  "Wandering|NoEvent":  "Wandering",
  "Chasing|EatPP":      "Frightened",
  "Chasing|KillP":      "Wandering",
  "Chasing|SeeP":       "Chasing",
  "Frightened|CatchG":  "Eaten",
  "Frightened|Timer":   "Wandering",
  "Frightened|NoEvent": "Frightened",
  "Eaten|Home":         "Wandering",
  "Eaten|NoEvent":      "Eaten",
};

const STEP_TABLE = [
  { from:"Wandering",  input:"SeeP",    to:"Chasing",    self:false, meaning:"Ghost detects Pac-Man within range — begins pursuit." },
  { from:"Wandering",  input:"EatPP",   to:"Frightened", self:false, meaning:"Pac-Man eats power pellet while ghost patrols — ghost becomes vulnerable." },
  { from:"Wandering",  input:"KillP",   to:"Wandering",  self:true,  meaning:"Ghost touches Pac-Man. Pac-Man dies, ghost resets to patrol." },
  { from:"Wandering",  input:"NoEvent", to:"Wandering",  self:true,  meaning:"(Self-Loop) Nothing happens — ghost continues patrolling." },
  { from:"Chasing",    input:"EatPP",   to:"Frightened", self:false, meaning:"Pac-Man eats a power pellet — ghost becomes vulnerable." },
  { from:"Chasing",    input:"KillP",   to:"Wandering",  self:false, meaning:"Ghost catches Pac-Man and returns to patrol." },
  { from:"Chasing",    input:"SeeP",    to:"Chasing",    self:true,  meaning:"(Self-Loop) Ghost still sees Pac-Man — continues chasing." },
  { from:"Frightened", input:"CatchG",  to:"Eaten",      self:false, meaning:"Pac-Man eats the vulnerable ghost." },
  { from:"Frightened", input:"Timer",   to:"Wandering",  self:false, meaning:"Power pellet wears off — ghost reverts to normal." },
  { from:"Frightened", input:"NoEvent", to:"Frightened", self:true,  meaning:"(Self-Loop) Power pellet still active — ghost keeps fleeing." },
  { from:"Eaten",      input:"Home",    to:"Wandering",  self:false, meaning:"Ghost's eyes reach center base — ghost respawns." },
  { from:"Eaten",      input:"NoEvent", to:"Eaten",      self:true,  meaning:"(Self-Loop) Ghost eyes still travelling back to base." },
];

const STATE_CFG = {
  Wandering:  { q: "q₀", color:"#0288d1", bg:"#e1f5fe", emoji:"👻", label:"WANDERING",  desc:"Patrolling — random path" },
  Chasing:    { q: "q₁", color:"#d32f2f", bg:"#ffebee", emoji:"😡", label:"CHASING",    desc:"Hunting Pac-Man" },
  Frightened: { q: "q₂", color:"#8e24aa", bg:"#f3e5f5", emoji:"😨", label:"FRIGHTENED", desc:"Vulnerable — fleeing" },
  Eaten:      { q: "q₃", color:"#455a64", bg:"#eceff1", emoji:"👀", label:"EATEN",      desc:"Eyes returning to base" },
};

// ==========================================
//  MAZE CONFIGURATION & CONSTANTS
// ==========================================
const CELL = 34;
const COLS = 15, ROWS = 12;
const BASE       = { r:5, c:7 };
const PAC_START  = { r:8, c:7 };

const GAME_SEC   = 90;   
const TICK_MS    = 250;  // Slower tick
const FRIGHT_MAX = 20;   // 5.0 seconds
const PAC_RESPAWN_TICKS = 8;   // 2.0 seconds
const GHOST_RESPAWN_TICKS = 12;// 3.0 seconds

const MAZE_TEMPLATE = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,3,2,2,2,2,2,1,2,2,2,2,2,3,1],
  [1,2,1,2,1,2,2,1,2,2,1,2,1,2,1],
  [1,2,1,2,1,2,1,2,1,2,1,2,1,2,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,1,2,1,0,0,0,1,2,1,1,2,1],
  [1,2,2,2,2,1,0,0,0,1,2,2,2,2,1],
  [1,1,1,2,1,1,1,4,1,1,1,2,1,1,1],
  [1,2,2,2,2,2,2,2,2,2,2,2,2,2,1],
  [1,2,1,2,1,2,2,1,2,2,1,2,1,2,1],
  [1,3,2,2,2,2,2,1,2,2,2,2,2,3,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const DIRS = [{r:0,c:1},{r:0,c:-1},{r:1,c:0},{r:-1,c:0}];

// ==========================================
//  PURE AI HELPERS
// ==========================================
function walkableForPac(r,c){
  if(r<0||r>=ROWS||c<0||c>=COLS) return false;
  const v=MAZE_TEMPLATE[r][c];
  return v!==1 && v!==0; 
}
function walkableForGhost(r,c){
  if(r<0||r>=ROWS||c<0||c>=COLS) return false;
  return MAZE_TEMPLATE[r][c]!==1;
}
function mdist(a,b){ return Math.abs(a.r-b.r)+Math.abs(a.c-b.c); }

function movePos(pos,dir,forPac=false){
  const nr=pos.r+dir.r, nc=pos.c+dir.c;
  const fn=forPac?walkableForPac:walkableForGhost;
  if(!fn(nr,nc)) return null;
  return {r:nr,c:nc};
}

function rndDir(pos,last,forPac=false){
  const rev={r:-last.r,c:-last.c};
  const opts=DIRS.filter(d=>!(d.r===rev.r&&d.c===rev.c)&&movePos(pos,d,forPac));
  if(opts.length) return opts[Math.floor(Math.random()*opts.length)];
  const all=DIRS.filter(d=>movePos(pos,d,forPac));
  if(all.length) return all[Math.floor(Math.random()*all.length)];
  return last;
}

function bfsNextDir(from, target, forPac) {
  if (from.r === target.r && from.c === target.c) return null;
  const key = (r, c) => `${r},${c}`;
  const q = [];
  const vis = new Set([key(from.r, from.c)]);

  for (const d of DIRS) {
    const np = movePos(from, d, forPac);
    if (np) {
      q.push({ pos: np, initialDir: d });
      vis.add(key(np.r, np.c));
    }
  }

  let head = 0;
  while (head < q.length) {
    const curr = q[head++];
    if (curr.pos.r === target.r && curr.pos.c === target.c) return curr.initialDir;
    for (const d of DIRS) {
      const np = movePos(curr.pos, d, forPac);
      if (np && !vis.has(key(np.r, np.c))) {
        vis.add(key(np.r, np.c));
        q.push({ pos: np, initialDir: curr.initialDir });
      }
    }
  }
  return null; 
}

function bfsFindNearestDot(from, pellets, pps) {
  const isDot = (r, c) => pellets.some(p=>p[0]===r&&p[1]===c) || pps.some(p=>p[0]===r&&p[1]===c);
  if (isDot(from.r, from.c)) return null;

  const key = (r, c) => `${r},${c}`;
  const q = [];
  const vis = new Set([key(from.r, from.c)]);

  for (const d of DIRS) {
    const np = movePos(from, d, true);
    if (np) { q.push({ pos: np, initialDir: d }); vis.add(key(np.r, np.c)); }
  }

  let head = 0;
  while (head < q.length) {
    const curr = q[head++];
    if (isDot(curr.pos.r, curr.pos.c)) return curr.initialDir;
    for (const d of DIRS) {
      const np = movePos(curr.pos, d, true);
      if (np && !vis.has(key(np.r, np.c))) {
        vis.add(key(np.r, np.c));
        q.push({ pos: np, initialDir: curr.initialDir });
      }
    }
  }
  return null;
}

function fleeDir(from, target, lastDir) {
  let best = null, bestD = -Infinity;
  for (const d of DIRS) {
    const rev = { r: -lastDir.r, c: -lastDir.c };
    if (d.r === rev.r && d.c === rev.c) continue; 
    const np = movePos(from, d, false);
    if (!np) continue;
    const dist = mdist(np, target);
    if (dist > bestD) { bestD = dist; best = d; }
  }
  return best || rndDir(from, lastDir, false);
}

// ==========================================
//  DFA DIAGRAM RENDERER (MASSIVE LAYOUT UPDATE)
// ==========================================

// 🚨 Increased SVG canvas size and spread nodes much further apart 🚨
const SVG_W=680, SVG_H=380;
const NP = {
  Wandering:  { x: 120, y: 190 },
  Chasing:    { x: 350, y: 105 },
  Frightened: { x: 350, y: 275 },
  Eaten:      { x: 580, y: 190 }
};

// 🚨 Adjusted curve strengths to match the new wide layout 🚨
const ARROWS = [
  { from:"Wandering",  to:"Chasing",    label:"SeeP",          curve:{ dx:0,   dy:-75 } },
  { from:"Chasing",    to:"Wandering",  label:"LoseP/KillP",   curve:{ dx:0,   dy:-35 } },
  { from:"Wandering",  to:"Frightened", label:"EatPP",         curve:{ dx:-65, dy:95  } },
  { from:"Chasing",    to:"Frightened", label:"EatPP",         curve:{ dx:75,  dy:0   } },
  { from:"Frightened", to:"Wandering",  label:"Timer",         curve:{ dx:0,   dy:75  } },
  { from:"Frightened", to:"Eaten",      label:"CatchG",        curve:{ dx:0,   dy:-75 } },
  { from:"Eaten",      to:"Wandering",  label:"Home",          curve:{ dx:0,   dy:85  } },
  { from:"Wandering",  to:"Wandering",  label:"NoEvent/KillP", loop:true, loopUp:true  },
  { from:"Chasing",    to:"Chasing",    label:"SeeP",          loop:true, loopUp:true  },
  { from:"Frightened", to:"Frightened", label:"NoEvent",       loop:true, loopUp:false },
  { from:"Eaten",      to:"Eaten",      label:"NoEvent",       loop:true, loopUp:true  },
];

function quadPt(p1,p2,cp,t){ return{x:(1-t)*(1-t)*p1.x+2*(1-t)*t*cp.x+t*t*p2.x,y:(1-t)*(1-t)*p1.y+2*(1-t)*t*cp.y+t*t*p2.y}; }

function DFADiagram({currentState,activeArrow,frightPct}){
  const [anim,setAnim]=useState(0);
  useEffect(()=>{ const id=setInterval(()=>setAnim(a=>a+1),80); return()=>clearInterval(id); },[]);
  const isActive=a=>activeArrow&&activeArrow.from===a.from&&activeArrow.to===a.to;
  
  return(
    <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{display:"block",overflow:"visible"}}>
      <defs>
        {/* 🚨 Bigger Arrow Heads 🚨 */}
        {STATES.map(s=>(
          <marker key={s} id={`m-${s}`} markerWidth="14" markerHeight="10" refX="10" refY="5" orient="auto">
            <polygon points="0,0 14,5 0,10" fill={STATE_CFG[s].color} opacity="1"/>
          </marker>
        ))}
        <marker id="m-active" markerWidth="14" markerHeight="10" refX="10" refY="5" orient="auto">
          <polygon points="0,0 14,5 0,10" fill="#111"/>
        </marker>
        <filter id="gs"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="gw"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      {ARROWS.map((a,i)=>{
        const act=isActive(a);
        const sc=act?"#111":STATE_CFG[a.to].color;
        const sw=act?4.5:3.0; // 🚨 Thicker Paths 🚨
        const op=act?1:0.7;
        
        if(a.loop){
          const{x,y}=NP[a.from], R=40, up=a.loopUp, lH=60, lW=40; // 🚨 Bigger Loops 🚨
          const sx=x-lW/2, sy=up?y-R:y+R, ex=x+lW/2, ey=up?y-R:y+R;
          const cy2=up?y-R-lH:y+R+lH, lY=up?y-R-lH*0.7:y+R+lH*0.7;
          return(<g key={i}>
            <path d={`M${sx},${sy} C${sx-10},${cy2} ${ex+10},${cy2} ${ex},${ey}`} fill="none" stroke={sc} strokeWidth={sw} strokeDasharray={act?"none":"6,4"} opacity={op} markerEnd={act?"url(#m-active)":`url(#m-${a.to})`}/>
            <text x={x} y={lY-(up?4:-4)} textAnchor="middle" fontSize="13" fill={sc} fontFamily="'Inter',sans-serif" fontWeight="900" opacity={act?1:0.85}>{a.label}</text>
          </g>);
        }
        
        const p1=NP[a.from],p2=NP[a.to];
        const cp={x:(p1.x+p2.x)/2+a.curve.dx,y:(p1.y+p2.y)/2+a.curve.dy};
        const mid=quadPt(p1,p2,cp,0.5);
        const loY=a.curve.dy<0?-14:14, loX=a.curve.dx>0?12:a.curve.dx<0?-12:0;
        
        return(<g key={i}>
          <path d={`M${p1.x},${p1.y} Q${cp.x},${cp.y} ${p2.x},${p2.y}`} fill="none" stroke={sc} strokeWidth={sw} strokeDasharray={act?"none":"8,5"} opacity={op} markerEnd={act?"url(#m-active)":`url(#m-${a.to})`}/>
          <text x={mid.x+loX} y={mid.y+loY} textAnchor="middle" fontSize="13" fill={sc} fontFamily="'Inter',sans-serif" fontWeight="900" opacity={act?1:0.85}>{a.label}</text>
        </g>);
      })}
      
      <g opacity="1">
        {/* 🚨 Thicker, clearer START indicator 🚨 */}
        <line x1="20" y1={NP.Wandering.y} x2={NP.Wandering.x-45} y2={NP.Wandering.y} stroke={STATE_CFG.Wandering.color} strokeWidth="3.5" markerEnd="url(#m-Wandering)"/>
        <text x="35" y={NP.Wandering.y-12} fontSize="14" fill={STATE_CFG.Wandering.color} fontFamily="'Inter',sans-serif" fontWeight="900">START</text>
      </g>

      {STATES.map(s=>{
        const{x,y}=NP[s],cfg=STATE_CFG[s],act=s===currentState;
        const R = 38; // 🚨 Massively increased Node Size (from 28 to 38) 🚨
        
        return(<g key={s} transform={`translate(${x},${y})`}>
          {act&&[24,12].map((e,ri)=>(<circle key={ri} r={R+e} fill="none" stroke={cfg.color} strokeWidth="2.5" opacity={0.25+Math.sin(anim*0.14+ri)*0.15}/>))}
          <circle r={R} fill={act?cfg.bg:"#ffffff"} stroke={cfg.color} strokeWidth={act?5:3.5} style={{transition:"fill 0.4s,stroke-width 0.3s"}}/>
          
          {s==="Eaten"&&<circle r={R-8} fill="none" stroke={cfg.color} strokeWidth={act?4:3} style={{transition:"stroke-width 0.3s"}}/>}
          
          {s==="Frightened"&&act&&frightPct>0&&(()=>{
            const ang=frightPct*Math.PI*2-Math.PI/2;
            const ex=R*Math.cos(ang),ey=R*Math.sin(ang),lg=frightPct>0.5?1:0;
            return<path d={`M0,${-R} A${R},${R} 0 ${lg},1 ${ex},${ey}`} fill="none" stroke={cfg.color} strokeWidth="6" strokeLinecap="round" opacity="0.85"/>;
          })()}
          
          {/* 🚨 Bigger Emojis and Internal Text 🚨 */}
          <text textAnchor="middle" dominantBaseline="central" fontSize={act?32:26} y="-4" style={{transition:"font-size 0.25s",userSelect:"none"}}>{cfg.emoji}</text>
          <text textAnchor="middle" y="18" fontSize="14" fill={cfg.color} fontFamily="'Inter',sans-serif" fontWeight="900" opacity="0.95">{cfg.q}</text>
          <text textAnchor="middle" y={R+20} fontSize="13" fill={cfg.color} fontFamily="'Inter',sans-serif" fontWeight="900" letterSpacing="0.5">{s}</text>
        </g>);
      })}
    </svg>
  );
}

// ==========================================
//  SCORE POPUP OVERLAY
// ==========================================
function ScorePopup({text,x,y,color}){
  return(
    <div className="score-pop" style={{left:x,top:y,color, fontWeight: 900, fontSize: "1.4rem"}}>{text}</div>
  );
}

// ==========================================
//  MAZE CANVAS (LIGHT THEME UPDATE)
// ==========================================
function MazeCanvas({ghostState,ghostPos,pacPos,pellets,powerPellets,tick,ghostEatenFlash,pacDead,pacRespawnTimer,ghostRespawnTimer,pacBig,frightTicks}){
  const ref=useRef(null);
  useEffect(()=>{
    const cv=ref.current; if(!cv) return;
    const ctx=cv.getContext("2d"); const t=tick;
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.fillStyle="#f8f9fa"; ctx.fillRect(0,0,cv.width,cv.height);

    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const v=MAZE_TEMPLATE[r][c],x=c*CELL,y=r*CELL;
      if(v===1){
        ctx.fillStyle="#e3f2fd"; ctx.fillRect(x,y,CELL,CELL);
        ctx.strokeStyle="#1976d2"; ctx.lineWidth=2;
        ctx.strokeRect(x+1.5,y+1.5,CELL-3,CELL-3);
      } else if(v===0){
        ctx.fillStyle="#f8f9fa"; ctx.fillRect(x,y,CELL,CELL);
      }
    }
    
    ctx.strokeStyle="#ce93d8"; ctx.lineWidth=3.5;
    ctx.beginPath(); ctx.moveTo(6*CELL,5*CELL); ctx.lineTo(9*CELL,5*CELL); ctx.stroke();

    pellets.forEach(([r,c])=>{
      ctx.beginPath(); ctx.arc(c*CELL+CELL/2,r*CELL+CELL/2,3.5,0,Math.PI*2);
      ctx.fillStyle="#ff9800"; ctx.fill(); 
    });
    
    powerPellets.forEach(([r,c])=>{
      const pulse=7+Math.sin(t*0.2)*3;
      const px=c*CELL+CELL/2,py=r*CELL+CELL/2;
      ctx.beginPath(); ctx.arc(px,py,pulse+6,0,Math.PI*2);
      ctx.fillStyle="rgba(255,87,34,0.15)"; ctx.fill();
      ctx.beginPath(); ctx.arc(px,py,pulse,0,Math.PI*2);
      ctx.fillStyle="#ff5722"; ctx.fill(); 
    });

    // ── PAC-MAN ──
    const px=pacPos.c*CELL+CELL/2, py2=pacPos.r*CELL+CELL/2;
    const bigPct=pacBig?Math.min(1,frightTicks/FRIGHT_MAX):0;
    const PR=pacBig?12+8*bigPct:12;

    if(pacDead){
      const dp=Math.max(0,pacRespawnTimer/(PAC_RESPAWN_TICKS*TICK_MS));
      const rad=PR*dp;
      if(rad>0.5){
        ctx.beginPath(); ctx.arc(px,py2,rad,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,179,0,${dp})`; ctx.fill();
      }
    } else {
      const mth=Math.abs(Math.sin(t*0.4))*0.5;
      if(pacBig){
        ctx.beginPath(); ctx.arc(px,py2,PR+8+Math.sin(t*0.3)*3,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,179,0,${0.15*bigPct})`; ctx.fill();
        ctx.beginPath(); ctx.arc(px,py2,PR+4,0,Math.PI*2);
        ctx.strokeStyle=`rgba(255,152,0,${0.8*bigPct})`; ctx.lineWidth=3; ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(px,py2); ctx.arc(px,py2,PR,mth,Math.PI*2-mth); ctx.closePath();
      ctx.fillStyle="#ffb300"; 
      ctx.fill(); 
    }

    // ── GHOST ──
    const gx=ghostPos.c*CELL+CELL/2, gy=ghostPos.r*CELL+CELL/2;
    const GR=12; const cfg=STATE_CFG[ghostState];

    if(ghostEatenFlash){
      ctx.font="bold 18px 'Inter',sans-serif"; ctx.textAlign="center";
      ctx.fillStyle="#8e24aa"; ctx.fillText("+200",gx,gy-24); ctx.textAlign="left";
    }

    if(ghostState==="Eaten"){
      ctx.fillStyle="white";
      ctx.beginPath(); ctx.ellipse(gx-4,gy,4,5,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(gx+4,gy,4,5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#000000"; 
      ctx.beginPath(); ctx.arc(gx-2.5,gy+1,2.5,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(gx+5.5,gy+1,2.5,0,Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(gx,gy-2,GR,Math.PI,0);
      const ww=(GR*2)/3;
      for(let i=0;i<3;i++){ const wx=gx+GR-i*ww; ctx.quadraticCurveTo(wx-ww/4,gy+GR+4,wx-ww/2,gy+GR); }
      ctx.lineTo(gx-GR,gy-2); ctx.closePath();
      const ff=ghostState==="Frightened"&&frightTicks<8&&Math.sin(t*0.8)>0; 
      
      if(ghostState==="Frightened"){ ctx.fillStyle=ff?"#9e9e9e":"#1e88e5"; }
      else { ctx.fillStyle=cfg.color; }
      ctx.fill(); 
      
      if(ghostState!=="Frightened"){
        ctx.fillStyle="white";
        ctx.beginPath(); ctx.ellipse(gx-4,gy-2,3.5,4.5,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(gx+4,gy-2,3.5,4.5,0,0,Math.PI*2); ctx.fill();
        ctx.fillStyle="#000000"; 
        ctx.beginPath(); ctx.arc(gx-2.5,gy-1.5,2,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx+5.5,gy-1.5,2,0,Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle=ff?"#fff":"#ffb300"; 
        ctx.beginPath(); ctx.arc(gx-3.5,gy-1,2.5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(gx+3.5,gy-1,2.5,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=ff?"#fff":"#ffb300"; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(gx-7,gy+4);
        for(let i=0;i<5;i++) ctx.lineTo(gx-7+i*3.5,gy+4-(i%2===0?0:3));
        ctx.stroke();
      }
    }
    
    ctx.font="bold 9px 'Inter',sans-serif"; ctx.textAlign="center";
    ctx.fillStyle=cfg.color;
    ctx.fillText(`${cfg.q} ${ghostState.toUpperCase()}`,gx,gy-GR-9); ctx.textAlign="left";

  },[ghostState,ghostPos,pacPos,pellets,powerPellets,tick,ghostEatenFlash,pacDead,pacRespawnTimer,ghostRespawnTimer,pacBig,frightTicks]);

  return <canvas ref={ref} className="maze-canvas" width={COLS*CELL} height={ROWS*CELL}/>;
}

// ==========================================
//  MAIN APP
// ==========================================
export default function App(){
  const [timeLeft,  setTimeLeft]  = useState(GAME_SEC);
  const [running,   setRunning]   = useState(true);
  const [activeStep,setActiveStep]= useState(null);
  const [mazeLevel, setMazeLevel] = useState(1);
  const [mazeFlash, setMazeFlash] = useState(false);
  const [ghostEatenFlash,setGhostEatenFlash] = useState(false);
  const [score,     setScore]     = useState(0);
  const [gameOver,  setGameOver]  = useState(false);
  const [gameOverMsg,setGameOverMsg] = useState("");

  const [pacDead, setPacDead] = useState(false);
  const [pacRespawnTimer, setPacRespawnTimer] = useState(0);
  const [pacBig, setPacBig] = useState(false);
  
  const [ghostRespawnTimer, setGhostRespawnTimer] = useState(0);

  const [currentState, setCurrentState] = useState("Wandering");
  const [activeArrow, setActiveArrow]  = useState(null);
  const [log, setLog] = useState([]);
  const [frightTicks, setFrightTicks]  = useState(0);

  const [ghostPos,setGhostPos] = useState({...BASE});
  const [pacPos,  setPacPos]   = useState({...PAC_START});
  const [ghostDir,setGhostDir] = useState({r:0,c:1});
  const [pacDir,  setPacDir]   = useState({r:0,c:-1});
  const [tick,    setTick]     = useState(0);

  const [popups,setPopups] = useState([]);
  const popId = useRef(0);
  
  const spawnPop = useCallback((txt,col,row,color="#ff9800")=>{
    const id=++popId.current;
    setPopups(p=>[...p,{id,txt,x:col*CELL+CELL/2,y:row*CELL-4,color}]);
    setTimeout(()=>setPopups(p=>p.filter(x=>x.id!==id)),900);
  },[]);

  const initPellets = ()=>{const p=[];MAZE_TEMPLATE.forEach((row,r)=>row.forEach((v,c)=>{if(v===2)p.push([r,c]);}));return p;};
  const initPPs     = ()=>{const p=[];MAZE_TEMPLATE.forEach((row,r)=>row.forEach((v,c)=>{if(v===3)p.push([r,c]);}));return p;};

  const [pellets,      setPellets]      = useState(initPellets);
  const [powerPellets, setPowerPellets] = useState(initPPs);

  const sRef=useRef(currentState);
  const ftRef=useRef(frightTicks);
  const gRef=useRef(ghostPos);
  const pRef=useRef(pacPos);
  const gdRef=useRef(ghostDir);
  const pdRef=useRef(pacDir);
  const ppRef=useRef(powerPellets);
  const pelRef=useRef(pellets);
  const pacDeadTicksRef=useRef(0);
  const ghostDeadTicksRef=useRef(0);
  const pacBigRef=useRef(pacBig);

  useEffect(()=>{
    sRef.current=currentState; ftRef.current=frightTicks;
    gRef.current=ghostPos; pRef.current=pacPos;
    gdRef.current=ghostDir; pdRef.current=pacDir;
    ppRef.current=powerPellets; pelRef.current=pellets;
    pacBigRef.current=pacBig;
  },[currentState,frightTicks,ghostPos,pacPos,ghostDir,pacDir,powerPellets,pellets,pacBig]);

  const resetMaze = useCallback((keepTime=false)=>{
    setCurrentState("Wandering"); sRef.current="Wandering";
    setGhostPos({...BASE}); gRef.current={...BASE};
    setPacPos({...PAC_START}); pRef.current={...PAC_START};
    const np=initPellets(), npp=initPPs();
    setPellets(np); setPowerPellets(npp); 
    pelRef.current=np; ppRef.current=npp;
    setFrightTicks(0); ftRef.current=0;
    setPacBig(false); pacBigRef.current=false;
    if(!keepTime){setTimeLeft(GAME_SEC); setRunning(true); }
    setActiveStep(null); setActiveArrow(null);
    setPacDead(false); pacDeadTicksRef.current=0; setPacRespawnTimer(0);
    ghostDeadTicksRef.current=0; setGhostRespawnTimer(0);
    setPopups([]);
    setMazeFlash(false); 
  },[]); 

  const resetSim = useCallback(()=>{
    setMazeLevel(1); setScore(0); setGameOver(false); 
    setLog([{id:Date.now(),t:"--:--",from:"SYS",to:"START",input:"SIMULATION RESET"}]);
    setTick(0); resetMaze(false);
  },[resetMaze]);

  useEffect(()=>{
    if(!running) return;
    const id=setInterval(()=>{
      setTimeLeft(prev=>{
        if(prev<=1){setRunning(false);setGameOver(true);setGameOverMsg("⏰ TIME'S UP!");return 0;}
        return prev-1;
      });
    },1000);
    return()=>clearInterval(id);
  },[running]);

  const fireTransition = useCallback((input)=>{
    const state=sRef.current, key2=`${state}|${input}`;
    if(!TRANSITIONS[key2]) return false;
    
    const next=TRANSITIONS[key2];
    const arrow=ARROWS.find(a=>a.from===state && (a.label.includes(input) || a.to===next));
    
    sRef.current=next; 
    setCurrentState(next);
    setActiveArrow(arrow?{...arrow}:null);
    
    const si=STEP_TABLE.findIndex(s=>s.from===state&&s.input===input);
    if(si>=0) setActiveStep(si);
    
    setLog(prev=>[{id:Date.now(),t:new Date().toLocaleTimeString("en-US",{hour12:false}),from:state,to:next,input},...prev].slice(0,12));
    setTimeout(()=>{setActiveArrow(null);setActiveStep(null);},1000);

    if(input === "KillP") {
        setPacDead(true);
        setPacPos({...PAC_START}); pRef.current={...PAC_START};
        setPacBig(false); pacBigRef.current = false;
        pacDeadTicksRef.current = PAC_RESPAWN_TICKS;
        setPacRespawnTimer(PAC_RESPAWN_TICKS * TICK_MS);
    }
    if(input === "CatchG") {
        setGhostEatenFlash(true); setTimeout(()=>setGhostEatenFlash(false),800);
        setGhostPos({...BASE}); gRef.current={...BASE};
        ghostDeadTicksRef.current = GHOST_RESPAWN_TICKS;
        setGhostRespawnTimer(GHOST_RESPAWN_TICKS * TICK_MS);
    }

    return true;
  },[]); 

  useEffect(()=>{
    if(!running||gameOver) return;
    
    let localTick = tick;

    const id=setInterval(()=>{
      localTick++;
      setTick(localTick);
      const state = sRef.current;
      
      let nextPacPos = pRef.current;
      let nextGhostPos = gRef.current;
      let pacMoved = false;
      let ghostMoved = false;
      
      const pacCanMove = pacBigRef.current ? (localTick % 3 !== 0) : (localTick % 2 === 0);
      
      if (pacDeadTicksRef.current > 0) {
        pacDeadTicksRef.current--;
        setPacRespawnTimer(pacDeadTicksRef.current * TICK_MS);
        if (pacDeadTicksRef.current === 0) setPacDead(false);
      } 
      else if (pacCanMove) {
        let target = (state==="Frightened") ? gRef.current : null;
        let dir = pdRef.current;
        
        if (target) {
            dir = bfsNextDir(pRef.current, target, true) || rndDir(pRef.current, dir, true);
        } else {
            const nearest = bfsFindNearestDot(pRef.current, pelRef.current, ppRef.current);
            if (nearest) dir = nearest;
            else if (!movePos(pRef.current, dir, true)) dir = rndDir(pRef.current, dir, true);
        }
        
        setPacDir(dir);
        nextPacPos = movePos(pRef.current, dir, true) || pRef.current;
        pacMoved = true;
      }

      const ghostCanMove = (state === "Frightened") ? (localTick % 3 === 0) : (localTick % 2 === 0);

      if (state === "Eaten") {
        if (ghostDeadTicksRef.current > 0) {
          ghostDeadTicksRef.current--;
          setGhostRespawnTimer(ghostDeadTicksRef.current * TICK_MS);
          
          if (ghostDeadTicksRef.current === 0) fireTransition("Home");
          else if (localTick % 6 === 0) fireTransition("NoEvent");
        }
      } 
      else if (ghostCanMove) {
        let dir = gdRef.current;
        if(state==="Wandering") {
            dir = (Math.random() < 0.2 || !movePos(gRef.current, dir, false)) ? rndDir(gRef.current, dir, false) : dir;
        } else if(state==="Chasing") {
            dir = bfsNextDir(gRef.current, nextPacPos, false) || rndDir(gRef.current, dir, false);
        } else if(state==="Frightened") {
            dir = fleeDir(gRef.current, nextPacPos, dir);
        }
        
        nextGhostPos = movePos(gRef.current, dir, false) || gRef.current;
        setGhostDir(dir); 
        ghostMoved = true;
      }

      const prevPac = pRef.current;
      const prevGhost = gRef.current;
      
      const sameTile = (nextPacPos.r === nextGhostPos.r && nextPacPos.c === nextGhostPos.c);
      const swappedTiles = pacMoved && ghostMoved &&
                           (nextPacPos.r === prevGhost.r && nextPacPos.c === prevGhost.c) &&
                           (nextGhostPos.r === prevPac.r && nextGhostPos.c === prevPac.c);

      if ((sameTile || swappedTiles) && state !== "Eaten" && pacDeadTicksRef.current === 0) {
        if ((state === "Wandering" || state === "Chasing") && !pacBigRef.current) {
           fireTransition("KillP");
           setPacDead(true);
           setPacBig(false); pacBigRef.current = false;
           nextPacPos = {...PAC_START}; 
           pacDeadTicksRef.current = PAC_RESPAWN_TICKS;
           setPacRespawnTimer(PAC_RESPAWN_TICKS * TICK_MS);
        } 
        else if (state === "Frightened" || pacBigRef.current) {
           fireTransition("CatchG");
           setGhostEatenFlash(true); 
           setScore(s=>s+200); spawnPop("+200 👻", BASE.c, BASE.r, "#8e24aa");
           setTimeout(()=>setGhostEatenFlash(false),800);
           
           nextGhostPos = {...BASE}; 
           ghostDeadTicksRef.current = GHOST_RESPAWN_TICKS;
           setGhostRespawnTimer(GHOST_RESPAWN_TICKS * TICK_MS);
        }
      } 
      else if (state !== "Eaten" && pacDeadTicksRef.current === 0) {
        const d = mdist(nextGhostPos, nextPacPos);
        if (state==="Wandering" && d<=5) fireTransition("SeeP");
        if (state==="Chasing" && d<=12 && localTick%15===0) fireTransition("SeeP");
        if (localTick%20===0) {
          if (state==="Wandering" && d>5) fireTransition("NoEvent");
          if (state==="Frightened" && d>1) fireTransition("NoEvent");
        }
      }

      if (pacDeadTicksRef.current === 0) {
        const eatPP = ppRef.current.some(([r,c])=>r===nextPacPos.r&&c===nextPacPos.c);
        if(eatPP){
          const npp = ppRef.current.filter(([r,c])=>!(r===nextPacPos.r&&c===nextPacPos.c));
          ppRef.current = npp; setPowerPellets(npp);
          setScore(s=>s+50); spawnPop("+50 ⚡",nextPacPos.c,nextPacPos.r,"#ff5722");
          
          const currentStateRef = sRef.current;
          if(currentStateRef==="Wandering"||currentStateRef==="Chasing"||currentStateRef==="Frightened") {
              if (currentStateRef !== "Frightened") fireTransition("EatPP");
          }
          
          setFrightTicks(FRIGHT_MAX); ftRef.current=FRIGHT_MAX;
          setPacBig(true); pacBigRef.current = true;
        } 
        else {
          const np = pelRef.current.filter(([r,c])=>!(r===nextPacPos.r&&c===nextPacPos.c));
          if(np.length!==pelRef.current.length){
            pelRef.current = np; setPellets(np);
            setScore(s=>s+10);
            if(np.length%8===0) spawnPop("+10",nextPacPos.c,nextPacPos.r,"#ff9800");
          }
        }
        
        if(pelRef.current.length+ppRef.current.length === 0){
          setMazeFlash(true); setGameOver(true); setGameOverMsg("🎉 ALL DOTS CLEARED!"); setRunning(false);
          return; 
        }
      }

      setPacPos(nextPacPos);
      pRef.current = nextPacPos;
      setGhostPos(nextGhostPos);
      gRef.current = nextGhostPos;

      if (ftRef.current > 0) {
        ftRef.current -= 1;
        setFrightTicks(ftRef.current);
        if (ftRef.current === 0) {
          if (sRef.current === "Frightened") fireTransition("Timer");
          setPacBig(false); 
          pacBigRef.current = false;
        }
      }

    }, TICK_MS);
    
    return ()=>clearInterval(id);
  }, [running, gameOver, fireTransition, spawnPop]); // eslint-disable-line

  const frightPct  = frightTicks/FRIGHT_MAX;
  const meta       = STATE_CFG[currentState];
  const timerPct   = timeLeft/GAME_SEC;
  const timerColor = timeLeft>20?"#2e7d32":timeLeft>10?"#ef6c00":"#c62828";
  const dotsLeft   = pellets.length+powerPellets.length;

  const manualInputs=[
    {label:"NoEvent",input:"NoEvent",icon:"⚪"},
    {label:"SeeP",   input:"SeeP",   icon:"👁"},
    {label:"EatPP",  input:"EatPP",  icon:"⚡"},
    {label:"Timer",  input:"Timer",  icon:"⏱"},
    {label:"CatchG", input:"CatchG", icon:"💀"},
    {label:"Home",   input:"Home",   icon:"🏠"},
    {label:"KillP",  input:"KillP",  icon:"🔪"},
  ];

  return(
    <div className="app-root">

      {gameOver&&(
        <div className="go-overlay">
          <div className="go-card" style={{
            borderColor:gameOverMsg.includes("CLEARED")?"#4caf50":"#d32f2f",
          }}>
            <div className="go-title" style={{
              color:gameOverMsg.includes("CLEARED")?"#2e7d32":"#c62828",
            }}>{gameOverMsg}</div>
            <div className="go-score">SCORE: <span style={{color:"#000",fontWeight:900}}>{score}</span></div>
            <div className="go-sub">{87-dotsLeft} / 87 dots collected</div>
            <button className="go-btn" onClick={resetSim}>🔄 PLAY AGAIN</button>
          </div>
        </div>
      )}

      {mazeFlash&&!gameOver&&(
        <div className="go-overlay" style={{pointerEvents:"none", background:"rgba(255,255,255,0.7)"}}>
          <div className="cleared-text" style={{color:"#2e7d32", textShadow:"none"}}>✨ MAZE CLEARED! ✨</div>
        </div>
      )}

      <header className="app-header">
        <div className="app-course-label">ICS3253 · AUTOMATA THEORY &amp; COMPUTATION</div>
        <h1 className="app-title">👻 PAC-MAN GHOST — LIVE DFA SIMULATOR</h1>

        <div className="timer-row">
          <div className="timer-box" style={{borderColor:`${timerColor}`}}>
            <span className="timer-label">DEMO TIME</span>
            <div className="timer-bar-wrap" style={{background: "#e0e0e0"}}>
              <div className="timer-bar-fill" style={{width:`${timerPct*100}%`,background:`${timerColor}`}}/>
            </div>
            <span className={`timer-digits${timeLeft<=10?" blink":""}`} style={{color:timerColor}}>
              {String(Math.floor(timeLeft/60)).padStart(2,"0")}:{String(timeLeft%60).padStart(2,"0")}
            </span>
          </div>
          <div className="hud-pill" style={{borderColor:"#0288d1",color:"#0288d1",background:"#e1f5fe"}}>
            <span className="hud-lbl">LVL</span><span className="hud-val">{mazeLevel}</span>
          </div>
          <div className="hud-pill" style={{borderColor:"#111",color:"#111",background:"#f5f5f5"}}>
            <span className="hud-lbl">SCORE</span><span className="hud-val">{score}</span>
          </div>
          <div className="hud-pill" style={{borderColor:"#e65100",color:"#e65100",background:"#fff3e0"}}>
            <span className="hud-lbl">DOTS</span><span className="hud-val">{dotsLeft}</span>
          </div>
          {pacBig&&(
            <div className="hud-pill power-badge" style={{background:"#ffe0b2", borderColor:"#ff9800", color:"#e65100"}}>
              <span className="hud-lbl">⚡ BIG</span>
              <span className="hud-val">{Math.max(1,Math.ceil(frightTicks*TICK_MS/1000))}s</span>
            </div>
          )}
          {currentState==="Eaten"&&ghostRespawnTimer>0&&(
            <div className="hud-pill" style={{borderColor:"#455a64",color:"#455a64",background:"#eceff1"}}>
              <span className="hud-lbl">👻 RESP</span>
              <span className="hud-val">{Math.ceil(ghostRespawnTimer/1000)}s</span>
            </div>
          )}
          <button className="reset-btn" onClick={resetSim}>🔄 RESET</button>
          {!running&&!gameOver&&<span className="sim-ended-badge">● SIM ENDED</span>}
        </div>
      </header>

      <div className="main-grid">

        <div className="maze-col">
          <div className="section-label">
            Live Simulation
            <span style={{marginLeft:8,fontSize:"12px",color:"#546e7a"}}>BFS-AI · Slower Presentation Mode</span>
          </div>
          <div className="maze-wrapper">
            <MazeCanvas ghostState={currentState} ghostPos={ghostPos} pacPos={pacPos}
              pellets={pellets} powerPellets={powerPellets} tick={tick}
              ghostEatenFlash={ghostEatenFlash} pacDead={pacDead}
              pacRespawnTimer={pacRespawnTimer} ghostRespawnTimer={ghostRespawnTimer}
              pacBig={pacBig} frightTicks={frightTicks}/>
            {popups.map(p=><ScorePopup key={p.id} text={p.txt} x={p.x} y={p.y} color={p.color}/>)}
          </div>

          <div className="state-badge" style={{borderColor:meta.color, background:meta.bg}}>
            <span className="state-badge-emoji">{meta.emoji}</span>
            <div style={{flex:1}}>
              <div className="state-badge-name" style={{color:meta.color}}>{meta.q} {meta.label}</div>
              <div className="state-badge-desc" style={{color:"#333"}}>{meta.desc}</div>
            </div>
            {currentState==="Frightened"&&frightPct>0&&(
              <div className="mini-bar-wrap">
                <div className="mini-bar-lbl" style={{color:"#8e24aa"}}>⚡ {Math.max(1,Math.ceil(frightTicks*TICK_MS/1000))}s</div>
                <div className="mini-bar" style={{background:"#fff"}}><div className="mini-bar-fill" style={{width:`${frightPct*100}%`, background:"#8e24aa"}}/></div>
              </div>
            )}
            {currentState==="Eaten"&&(
              <div className="mini-bar-wrap">
                <div className="mini-bar-lbl" style={{color:"#455a64"}}>RESPAWN {Math.ceil(ghostRespawnTimer/1000)}s</div>
                <div className="mini-bar" style={{background:"#fff"}}><div className="mini-bar-fill" style={{width:`${(ghostRespawnTimer/(GHOST_RESPAWN_TICKS*TICK_MS))*100}%`,background:"#455a64"}}/></div>
              </div>
            )}
            {pacDead&&(
              <div className="mini-bar-wrap">
                <div className="mini-bar-lbl" style={{color:"#d32f2f"}}>PAC {Math.ceil(pacRespawnTimer/1000)}s</div>
                <div className="mini-bar" style={{background:"#fff"}}><div className="mini-bar-fill" style={{width:`${(pacRespawnTimer/(PAC_RESPAWN_TICKS*TICK_MS))*100}%`,background:"#d32f2f"}}/></div>
              </div>
            )}
          </div>
        </div>

        <div className="diagram-col">
          <div className="section-label">DFA State Diagram (δ)</div>
          <div className="diagram-svg-wrap" style={{background:"#fff", border:"2px solid #cfd8dc"}}>
            <DFADiagram currentState={currentState} activeArrow={activeArrow} frightPct={frightPct}/>
          </div>
          <div>
            <div className="section-label" style={{marginTop:"20px"}}>Formal Definition</div>
            <div className="formal-box">
              <div>A <strong style={{color:"#111"}}>DFA</strong> M is a 5-tuple:</div>
              <div className="eq" style={{color:"#0288d1"}}>M = (Q, Σ, δ, q₀, F)</div>
              <div><span className="lbl">Q</span> = &#123; q₀ (Wandering), q₁ (Chasing), q₂ (Frightened), q₃ (Eaten) &#125;</div>
              <div><span className="lbl">Σ</span> = &#123; SeeP, EatPP, CatchG, Timer, Home, KillP, NoEvent &#125;</div>
              <div><span className="lbl">δ</span> : Q × Σ → Q</div>
              <div><span className="lbl">q₀</span> = q₀ (Wandering) &nbsp;(initial state)</div>
              <div><span className="lbl">F</span> = &#123; q₃ (Eaten) &#125; &nbsp;(accepting state)</div>
            </div>
          </div>
        </div>

        <div className="controls-col">
          <div className="section-label">Inputs (Σ)</div>
          <div className="panel" style={{padding:"10px"}}>
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {manualInputs.map(({label,input,icon})=>{
                const valid=!!TRANSITIONS[`${currentState}|${input}`];
                return(
                  <button key={input} className={`ebtn ${valid?"ok":""}`}
                    disabled={!running||gameOver} onClick={()=>fireTransition(input)}>
                    <span style={{fontSize:"1.2rem"}}>{icon}</span>
                    <span style={{flex:1}}>{label}</span>
                    <span className="ebtn-valid-dot" style={{color: valid?"#fff":"#9e9e9e"}}>{valid?"✓":"✗"}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="section-label" style={{marginTop:"20px"}}>Event Log</div>
          <div className="log-box">
            {log.length===0&&<div className="log-empty" style={{color:"#546e7a"}}>Awaiting events…</div>}
            {log.map(e=>(
              <div key={e.id} className="log-entry" style={{borderLeftColor:STATE_CFG[e.to]?.color||"#111"}}>
                <span className="log-entry-time" style={{color:"#546e7a"}}>{e.t}</span>
                <span className="log-entry-arrow">
                  <span style={{color:STATE_CFG[e.from]?.color||"#111"}}>{STATE_CFG[e.from]?.q} {e.from}</span>
                  <span style={{color:"#90a4ae", margin:"0 4px"}}> → </span>
                  <span style={{color:STATE_CFG[e.to]?.color||"#111"}}>{STATE_CFG[e.to]?.q} {e.to}</span>
                </span>
                <span className="log-entry-input" style={{color:"#111"}}>⚡ {e.input}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bottom-grid">
        <div>
          <div className="section-label">Transition Table δ(q, σ)</div>
          <div className="panel" style={{padding:0,overflow:"hidden"}}>
            <table className="trans-table">
              <thead><tr><th>State (q)</th><th>Input (σ)</th><th>Next (q′)</th><th>Type</th></tr></thead>
              <tbody>
                {Object.entries(TRANSITIONS).map(([k,to])=>{
                  const [from,inp]=k.split("|");
                  const isSelf=from===to;
                  const isAct=activeArrow&&activeArrow.from===from&&activeArrow.to===to;
                  return(
                    <tr key={k} className={`${isAct?"row-active":""} ${isSelf?"row-self":""}`}>
                      <td style={{color:STATE_CFG[from].color}}><strong>{STATE_CFG[from].q}</strong> {from}</td>
                      <td style={{color:"#111",fontWeight:"800"}}>{inp}</td>
                      <td style={{color:STATE_CFG[to].color}}><strong>{STATE_CFG[to].q}</strong> {to}</td>
                      <td style={{color:"#455a64"}}>{isSelf?<span className="type-self">⟳ Self-loop</span>:<span className="type-trans">→ Transition</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="section-label">Step-by-Step Walkthrough</div>
          <div className="step-table-wrap">
            <div className="step-table-header">
              <div>State (q)</div><div>Input (σ)</div><div>Next (q′)</div><div>Meaning / Game Event</div>
            </div>
            <div className="step-table-body">
              {STEP_TABLE.map((row,i)=>{
                const isAct=activeStep===i, isCur=row.from===currentState;
                return(
                  <div key={i}
                    className={["step-row",row.self?"row-self":"",isCur?"row-current":"",isAct?"row-active":""].join(" ").trim()}
                    style={isAct?{"--act-c":STATE_CFG[row.from].color}:{}}>
                    <div className="step-cell" style={{color:STATE_CFG[row.from].color}}><strong>{STATE_CFG[row.from].q}</strong>&nbsp;{row.from}</div>
                    <div className="step-cell"><span className="input-badge">{row.input}</span></div>
                    <div className="step-cell" style={{color:STATE_CFG[row.to].color}}><strong>{STATE_CFG[row.to].q}</strong>&nbsp;{row.to}</div>
                    <div className={`step-cell ${row.self?"step-meaning-self":"step-meaning-normal"}`} style={{color:"#333"}}>{row.meaning}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <footer className="app-footer" style={{color:"#455a64"}}>
        ICS3253 · AUTOMATA THEORY &amp; COMPUTATION · PAC-MAN DFA SIMULATOR © 2026
      </footer>
    </div>
  );
}