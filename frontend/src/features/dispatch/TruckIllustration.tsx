import { useId } from 'react';

/** Decorative vehicle shell; the labelled cargo and vehicle controls live above it. */
export function TruckIllustration() {
  const id = useId().replaceAll(':', '');

  return (
    <svg viewBox="0 0 960 360" className="truck-illustration" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-cab`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f5f8f7" />
          <stop offset=".45" stopColor="#d5ddd9" />
          <stop offset=".7" stopColor="#a0b0a8" />
          <stop offset="1" stopColor="#e8eeeb" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#49625d" />
          <stop offset="1" stopColor="#182d29" />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#e1e8e4" />
        </linearGradient>
      </defs>

      <ellipse cx="507" cy="333" rx="437" ry="13" fill="#173b2a" opacity=".10" />
      <path d="M65 272H941V307H65Z" fill="#36493f" />
      <path d="M201 288H719V312H201Z" fill="#7d9185" />
      <rect
        x="234"
        y="20"
        width="710"
        height="263"
        rx="5"
        fill={`url(#${id}-body)`}
        stroke="#899b91"
        strokeWidth="4"
      />
      <path d="M236 32H942M238 268H943" stroke="#aab9b0" strokeWidth="4" />
      <path
        d="M31 258L40 161Q46 128 79 104L122 65H214V285H40Q26 280 31 258Z"
        fill={`url(#${id}-cab)`}
        stroke="#71867a"
        strokeWidth="3"
      />
      <path
        d="M75 145L132 91H195V173H62Z"
        fill={`url(#${id}-glass)`}
        stroke="#7d9489"
        strokeWidth="4"
      />
      <path
        d="M125 101V168M203 87V260M61 188H193M62 196H192"
        stroke="#9bad9f"
        strokeWidth="3"
      />
      <rect x="149" y="190" width="28" height="6" rx="3" fill="#3e5549" />
      <rect
        x="30"
        y="234"
        width="50"
        height="21"
        rx="3"
        fill="#ecf4ee"
        stroke="#8a9d91"
        strokeWidth="2"
      />
      <rect x="30" y="259" width="48" height="19" rx="3" fill="#445f50" />
      <path
        d="M34 216L84 219M42 179L24 166V140H37"
        fill="none"
        stroke="#4c6558"
        strokeWidth="6"
      />
      <path
        d="M87 287A53 53 0 0 1 106 244A53 53 0 0 1 183 286"
        fill="#344b3d"
      />
      <rect
        x="250"
        y="290"
        width="94"
        height="28"
        rx="6"
        fill="#8e9e94"
        stroke="#65796b"
        strokeWidth="2"
      />

      {[135, 770, 880].map((x) => (
        <g key={x}>
          <circle cx={x} cy="293" r="41" fill="#27352e" stroke="#121e18" strokeWidth="4" />
          <circle cx={x} cy="293" r="25" fill="#b8c6bd" stroke="#81968a" strokeWidth="3" />
          <circle cx={x} cy="293" r="12" fill="#718778" />
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <circle
              key={angle}
              cx={x + 18 * Math.cos((angle * Math.PI) / 180)}
              cy={293 + 18 * Math.sin((angle * Math.PI) / 180)}
              r="2.5"
              fill="#425b4b"
            />
          ))}
        </g>
      ))}

      <path d="M374 300H693" stroke="#bac5bc" strokeWidth="5" />
      <rect x="929" y="280" width="13" height="17" fill="#ab4c44" />
    </svg>
  );
}
