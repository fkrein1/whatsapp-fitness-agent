import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const C = {
  header: "#0B141A",
  background: "#070B0D",
  sent: "#005C4B",
  received: "#202C33",
  ink: "#E9EDEF",
  muted: "#8696A0",
  green: "#00A884",
  darkGreen: "#5A1730",
  blueTick: "#AEBAC1",
};
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const appear = (frame: number, at: number) =>
  spring({ frame: frame - at, fps: 30, config: { damping: 23, stiffness: 220, mass: 0.72 } });

const Header = () => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 112,
      zIndex: 20,
      display: "flex",
      alignItems: "center",
      color: C.ink,
      background: C.header,
      padding: "0 25px",
      borderBottom: "1px solid rgba(255,255,255,.035)",
    }}
  >
    <div
      style={{
        width: 58,
        height: 58,
        borderRadius: 40,
        display: "grid",
        placeItems: "center",
        color: C.ink,
        fontSize: 49,
        marginRight: 15,
        background: "#161D21",
      }}
    >
      ‹
    </div>
    <div
      style={{
        width: 65,
        height: 65,
        borderRadius: 40,
        display: "grid",
        placeItems: "center",
        background: C.darkGreen,
        color: "white",
        fontSize: 25,
        fontWeight: 700,
      }}
    >
      <svg viewBox="0 0 48 48" width="39" height="39" aria-hidden="true">
        <circle cx="24" cy="17" r="7" fill="#FF6B8A" />
        <path d="M11 39c1.5-9 6-13 13-13s11.5 4 13 13" fill="#FF6B8A" />
      </svg>
    </div>
    <div style={{ marginLeft: 17, flex: 1 }}>
      <div style={{ fontSize: 29, fontWeight: 600 }}>Health Coach</div>
    </div>
    <div style={{ display: "flex", gap: 30, color: C.muted, fontSize: 29 }}>
      <span>◉</span>
      <span>⋮</span>
    </div>
  </div>
);

const MicIcon = ({ color = "currentColor" }: { color?: string }) => (
  <svg viewBox="0 0 32 32" width="37" height="37" aria-hidden="true" style={{ color }}>
    <rect
      x="11"
      y="3"
      width="10"
      height="18"
      rx="5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    />
    <path
      d="M7 16c0 6 3 9 9 9s9-3 9-9M16 25v5M11 30h10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

const Composer = () => {
  const frame = useCurrentFrame();
  const isRecording = frame >= 205 && frame < 238;
  const recordFrame = frame - 205;
  const seconds = Math.min(3, Math.floor(recordFrame / 10));

  if (isRecording) {
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 100,
          zIndex: 20,
          background: "#111719",
          display: "flex",
          alignItems: "center",
          gap: 20,
          padding: "0 22px",
          color: C.ink,
        }}
      >
        <div style={{ color: "#AEBAC1", fontSize: 24, width: 68, textAlign: "center" }}>
          0:0{seconds}
        </div>
        <div
          style={{
            flex: 1,
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: 48 }).map((_, index) => {
            const active = index < interpolate(recordFrame, [0, 32], [4, 48], clamp);
            const height = 9 + Math.abs(Math.sin(index * 1.73 + recordFrame * 0.24)) * 31;
            return (
              <span
                key={index}
                style={{
                  width: 4,
                  height,
                  borderRadius: 4,
                  background: active ? "#AEBAC1" : "#3A4449",
                }}
              />
            );
          })}
        </div>
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 30,
            border: "3px solid #FF4F6D",
            display: "grid",
            placeItems: "center",
            scale: 1 + Math.sin(recordFrame * 0.35) * 0.05,
          }}
        >
          <div style={{ width: 15, height: 22, borderRadius: 5, background: "#FF4F6D" }} />
        </div>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 32,
            background: "#21C063",
            color: "#07140D",
            fontSize: 34,
            display: "grid",
            placeItems: "center",
          }}
        >
          ➤
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 100,
        zIndex: 20,
        background: C.header,
        display: "flex",
        gap: 15,
        alignItems: "center",
        padding: "0 17px",
      }}
    >
      <div style={{ color: C.ink, fontSize: 51, fontWeight: 300 }}>＋</div>
      <div
        style={{
          height: 67,
          borderRadius: 35,
          background: "#202C33",
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 21px",
          color: "#8696A0",
          fontSize: 26,
        }}
      >
        <span style={{ flex: 1 }}></span>
        <svg viewBox="0 0 32 32" width="31" height="31" aria-hidden="true">
          <rect
            x="4"
            y="8"
            width="24"
            height="18"
            rx="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          />
          <circle cx="16" cy="17" r="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M10 8l2-3h8l2 3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      </div>
      <div style={{ width: 50, color: C.ink, display: "grid", placeItems: "center" }}>
        <MicIcon />
      </div>
    </div>
  );
};

const Time = ({ sent = false, value }: { sent?: boolean; value: string }) => (
  <span
    style={{
      float: "right",
      marginLeft: 14,
      marginTop: 9,
      fontSize: 17,
      lineHeight: 1,
      color: C.muted,
      whiteSpace: "nowrap",
    }}
  >
    {value} {sent ? <span style={{ color: C.blueTick, letterSpacing: -4 }}>✓✓</span> : null}
  </span>
);

const Bubble = ({
  children,
  sent = false,
  time,
  width,
}: {
  children: React.ReactNode;
  sent?: boolean;
  time: string;
  width?: number;
}) => (
  <div
    style={{
      width: width ?? "fit-content",
      maxWidth: sent ? 745 : 790,
      marginLeft: sent ? "auto" : 0,
      background: sent ? C.sent : C.received,
      color: C.ink,
      padding: "14px 18px 12px",
      borderRadius: sent ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
      boxShadow: "0 1px 2px rgba(0,0,0,.3)",
      fontSize: 27,
      lineHeight: 1.34,
      overflow: "hidden",
    }}
  >
    {children}
    <Time sent={sent} value={time} />
  </div>
);

const PhotoBubble = ({
  src,
  caption,
  time,
  height,
}: {
  src: string;
  caption: string;
  time: string;
  height: number;
}) => (
  <Bubble sent time={time} width={625}>
    <Img
      src={staticFile(src)}
      style={{
        width: "100%",
        height,
        display: "block",
        objectFit: "cover",
        borderRadius: 10,
        marginBottom: 13,
      }}
    />
    <span>{caption}</span>
  </Bubble>
);

const VoiceNote = ({ time }: { time: string }) => {
  const bars = [
    12, 19, 30, 18, 39, 26, 45, 21, 35, 42, 29, 17, 40, 33, 23, 43, 36, 20, 31, 41, 25, 15, 38, 28,
    42, 22, 34, 18, 40, 27, 14, 32, 21, 37,
  ];
  return (
    <div
      style={{
        width: 470,
        height: 98,
        marginLeft: "auto",
        background: C.sent,
        color: C.ink,
        padding: "9px 15px",
        borderRadius: "16px 4px 16px 16px",
        boxShadow: "0 1px 2px rgba(0,0,0,.3)",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <Img
        src={staticFile("avatar.png")}
        style={{
          width: 64,
          height: 64,
          flex: "0 0 auto",
          borderRadius: "50%",
          objectFit: "cover",
        }}
      />
      <div
        style={{
          width: 46,
          height: 46,
          flex: "0 0 auto",
          clipPath: "polygon(25% 12%, 88% 50%, 25% 88%)",
          background: "#D1E5DF",
        }}
      />
      <div style={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}>
        <div
          style={{
            height: 57,
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              flex: "0 0 auto",
              borderRadius: 9,
              background: "white",
            }}
          />
          {Array.from({ length: 30 }).map((_, index) => (
            <span
              key={index}
              style={{
                width: 4,
                height: bars[index % bars.length],
                flex: "0 0 auto",
                borderRadius: 5,
                background: "rgba(174,203,194,.62)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            height: 20,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            color: "#A9C5BD",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          <span>0:03</span>
          <span style={{ color: C.muted, whiteSpace: "nowrap" }}>
            {time} <span style={{ color: C.blueTick, letterSpacing: -4 }}>✓✓</span>
          </span>
        </div>
      </div>
    </div>
  );
};

const Typing = ({ frame }: { frame: number }) => (
  <div
    style={{
      width: 78,
      height: 52,
      background: C.received,
      borderRadius: "4px 16px 16px 16px",
      boxShadow: "0 1px 2px rgba(0,0,0,.3)",
      display: "flex",
      gap: 7,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {[0, 1, 2].map((index) => (
      <span
        key={index}
        style={{
          width: 9,
          height: 9,
          borderRadius: 10,
          background: "#98A4AA",
          translate: `0 ${Math.sin((frame - index * 4) * 0.33) * 4}px`,
        }}
      />
    ))}
  </div>
);

const Message = ({ at, y, children }: { at: number; y: number; children: React.ReactNode }) => {
  const frame = useCurrentFrame();
  const value = appear(frame, at);
  if (frame < at) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        left: 29,
        right: 29,
        opacity: value,
        translate: `0 ${interpolate(value, [0, 1], [17, 0])}px`,
        scale: interpolate(value, [0, 1], [0.985, 1]),
        transformOrigin: "bottom right",
      }}
    >
      {children}
    </div>
  );
};

const Chat = () => {
  const frame = useCurrentFrame();
  const scroll = interpolate(
    frame,
    [0, 105, 175, 240, 290, 340, 420, 470, 550, 630, 710, 800, 880, 1010, 1080, 1130],
    [
      0, 0, -170, -450, -650, -760, -1000, -1200, -1450, -1700, -1950, -2200, -2500, -2850, -3000,
      -3000,
    ],
    { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) },
  );
  return (
    <div
      style={{
        position: "absolute",
        top: 112,
        bottom: 100,
        left: 0,
        right: 0,
        overflow: "hidden",
        backgroundColor: C.background,
        backgroundImage: `url(${staticFile("whatsapp-doodle.svg")})`,
        backgroundSize: "310px 310px",
      }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: scroll, height: 3600 }}>
        <div
          style={{
            position: "absolute",
            top: 26,
            left: "50%",
            translate: "-50% 0",
            background: "#182229E8",
            borderRadius: 9,
            padding: "8px 16px",
            color: C.muted,
            boxShadow: "0 1px 1px rgba(0,0,0,.3)",
            fontSize: 18,
          }}
        >
          HOJE
        </div>

        <Message at={32} y={88}>
          <PhotoBubble
            src="meal.jpeg"
            caption="Carne de panela magra. Registra esse almoço."
            time="12:23"
            height={425}
          />
        </Message>
        {frame >= 82 && frame < 108 ? (
          <div style={{ position: "absolute", top: 630, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={106} y={630}>
          <Bubble time="12:23" width={760}>
            <div>Registrei ✅</div>
            <div style={{ marginTop: 13 }}>
              • Arroz branco, ~150 g: ~200 kcal
              <br />• Feijão, ~130 g: ~130 kcal
              <br />• Carne de panela magra, ~170 g: ~350 kcal
              <br />• Abóbora, ~150 g: ~80 kcal
              <br />• Polenta frita, ~100 g: ~180 kcal
              <br />• Folhas verdes, ~60 g: ~20 kcal
            </div>
            <div style={{ marginTop: 15, fontWeight: 700 }}>Total estimado: ~960 kcal</div>
            <div style={{ marginTop: 5 }}>Faixa provável: 850–1.100 kcal.</div>
          </Bubble>
        </Message>

        <Message at={238} y={1095}>
          <VoiceNote time="20:55" />
        </Message>
        {frame >= 263 && frame < 290 ? (
          <div style={{ position: "absolute", top: 1215, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={288} y={1215}>
          <Bubble time="20:55">
            <strong>Lançado ✅ Corrida de 5 km em 29 minutos.</strong>
            <div style={{ marginTop: 7 }}>Pace médio: 5:48 min/km.</div>
          </Bubble>
        </Message>

        <Message at={340} y={1395}>
          <PhotoBubble
            src="ouro-branco.jpeg"
            caption="Registra esse Ouro Branco"
            time="21:38"
            height={315}
          />
        </Message>
        {frame >= 377 && frame < 402 ? (
          <div style={{ position: "absolute", top: 1818, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={400} y={1818}>
          <Bubble time="21:39">
            <div style={{ fontWeight: 600 }}>Registrado ✅ 1 Ouro Branco Duo Nuts (22 g)</div>
            <div style={{ marginTop: 7 }}>
              114 kcal, 12,5 g de carboidratos, 6,5 g de gorduras e 1,5 g de proteína.
            </div>
          </Bubble>
        </Message>

        <Message at={465} y={1995}>
          <Bubble sent time="21:41">
            Fiquei em déficit calórico hoje?
          </Bubble>
        </Message>
        {frame >= 490 && frame < 517 ? (
          <div style={{ position: "absolute", top: 2084, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={515} y={2084}>
          <Bubble time="21:41" width={780}>
            Pelo que está registrado hoje:
            <div style={{ marginTop: 12 }}>
              • Ingestão: ~1.960 kcal
              <br />• Corrida: 5 km em 29 min
              <br />• Gasto diário estimado: 2.600–2.900 kcal
            </div>
            <div style={{ marginTop: 14, fontWeight: 700 }}>
              Provavelmente ficou em déficit de ~600–900 kcal.
            </div>
            <div style={{ marginTop: 6 }}>Considerando apenas o que foi registrado.</div>
          </Bubble>
        </Message>

        <Message at={625} y={2410}>
          <Bubble sent time="08:05">
            O que você sabe sobre mim?
          </Bubble>
        </Message>
        {frame >= 653 && frame < 682 ? (
          <div style={{ position: "absolute", top: 2499, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={680} y={2499}>
          <Bubble time="08:05" width={780}>
            Você é o Felipe, tem 37 anos, 1,80 m e está com 95 kg. Estima estar com cerca de 19% de
            gordura.
            <div style={{ marginTop: 13 }}>
              Quer chegar a 85 kg mantendo massa muscular, ficar mais leve e correr melhor. Seu
              objetivo é se tornar um atleta híbrido e fazer um HYROX em 2027.
            </div>
            <div style={{ marginTop: 13 }}>Você gosta de treino de força e corrida.</div>
          </Bubble>
        </Message>

        <Message at={800} y={2823}>
          <Bubble sent time="20:56">
            O que eu treinei essa semana?
          </Bubble>
        </Message>
        {frame >= 830 && frame < 860 ? (
          <div style={{ position: "absolute", top: 2912, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={858} y={2912}>
          <Bubble time="20:57" width={790}>
            Nesta semana você treinou 5 vezes:
            <div style={{ marginTop: 13 }}>
              <strong>Musculação, 2 sessões</strong>
              <br />• Terça: desenvolvimento, búlgaro, remada e flexão de perna
              <br />• Quinta: supino, extensora, barra fixa e RDL
            </div>
            <div style={{ marginTop: 13 }}>
              <strong>Corridas, 3 sessões</strong>
              <br />• Quarta: 6 km em 45 min
              <br />• Sexta: 4 km em 28 min
              <br />• Sábado: 5 km em 29 min
            </div>
            <div style={{ marginTop: 14, fontWeight: 700 }}>Total correndo: 15 km em 1h42min.</div>
          </Bubble>
        </Message>

        <Message at={1010} y={3395}>
          <Bubble sent time="21:02" width={150}>
            <span style={{ fontSize: 55, lineHeight: 1 }}>❤️</span>
          </Bubble>
        </Message>
        {frame >= 1035 && frame < 1062 ? (
          <div style={{ position: "absolute", top: 3525, left: 29 }}>
            <Typing frame={frame} />
          </div>
        ) : null}
        <Message at={1060} y={3525}>
          <Bubble time="21:02" width={520}>
            ❤️💪 Tamo junto, Felipe!
          </Bubble>
        </Message>
      </div>
    </div>
  );
};

export const FitnessAgentDemo = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        fontFamily,
        background: C.background,
      }}
    >
      <Header />
      <Chat />
      <Composer />
      <Sequence from={0} durationInFrames={1140}>
        <Audio
          src={staticFile("background-music.mp3")}
          startFrom={240}
          volume={(musicFrame) =>
            interpolate(musicFrame, [0, 55, 1060, 1125], [0, 0.22, 0.22, 0], clamp)
          }
        />
      </Sequence>
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: "inset 0 0 75px rgba(17,27,33,.035)",
          opacity: interpolate(frame, [0, 12], [0, 1], clamp),
        }}
      />
    </AbsoluteFill>
  );
};
