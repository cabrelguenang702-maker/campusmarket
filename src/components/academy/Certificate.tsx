import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { courseMinutes, formatDuration, type Course } from "@/lib/academy-model";

export type CertificateData = { name: string; course: Course; date: string; id: string };

const BLUE = "#0b7bd6";
const NAVY = "#0b1220";

/**
 * Certificat de réussite (format paysage A4). Dessiné à taille fixe 1000×707 puis mis à l'échelle
 * pour tenir dans son conteneur ; couleurs fixes pour rester lisible en thème sombre et à l'impression.
 */
export function CertificatePaper({ data, className }: { data: CertificateData; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1000));
    ro.observe(el);
    setScale(el.clientWidth / 1000);
    return () => ro.disconnect();
  }, []);
  const { name, course, date, id } = data;
  return (
    <div ref={wrap} className={cn("cert-wrap relative w-full overflow-hidden rounded-md bg-white shadow-panel", className)} style={{ aspectRatio: "1000 / 707" }}>
      <div className="cert-inner absolute left-0 top-0 origin-top-left" style={{ width: 1000, height: 707, transform: `scale(${scale})`, color: NAVY, fontFamily: "Sora, Manrope, system-ui, sans-serif" }}>
        <div className="absolute inset-4" style={{ border: `3px solid ${BLUE}` }} />
        <div className="absolute inset-7" style={{ border: `1px solid ${BLUE}80` }} />
        {[["left-4 top-4", "border-l-8 border-t-8"], ["right-4 top-4", "border-r-8 border-t-8"], ["left-4 bottom-4", "border-l-8 border-b-8"], ["right-4 bottom-4", "border-r-8 border-b-8"]].map(([pos, b]) => <span key={pos} className={cn("absolute h-16 w-16", pos, b)} style={{ borderColor: BLUE }} />)}

        <div className="absolute inset-x-0 top-14 text-center">
          <p style={{ color: BLUE, letterSpacing: "0.32em", fontSize: 15, fontWeight: 700 }}>CAMPUSMARKET ACADEMY</p>
          <h3 style={{ fontSize: 52, fontWeight: 800, marginTop: 18, lineHeight: 1.1 }}>Certificat de réussite</h3>
          <p style={{ marginTop: 26, fontSize: 17, color: "#4a5a70" }}>Ce certificat est décerné à</p>
          <p style={{ marginTop: 14, fontSize: 46, fontWeight: 700, color: BLUE, fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif" }}>{name}</p>
          <div style={{ width: 380, height: 2, background: `${BLUE}55`, margin: "10px auto 0" }} />
          <p style={{ marginTop: 24, fontSize: 17, color: "#4a5a70" }}>pour avoir suivi avec succès la formation</p>
          <p style={{ margin: "12px auto 0", maxWidth: 760, fontSize: 30, fontWeight: 700, lineHeight: 1.2 }}>{course.title}</p>
          <p style={{ marginTop: 14, fontSize: 15, color: "#4a5a70" }}>{course.modules.length} modules · {formatDuration(courseMinutes(course))} · niveau {course.level.toLowerCase()}</p>
        </div>

        <div className="absolute inset-x-24 bottom-16 flex items-end justify-between">
          <div style={{ width: 230, textAlign: "center" }}>
            <p style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontSize: 30, color: NAVY, lineHeight: 1 }}>{course.instructor.name}</p>
            <div style={{ height: 1, background: NAVY, margin: "6px 0 5px" }} />
            <p style={{ fontSize: 12, color: "#4a5a70" }}>Formateur · {course.instructor.name}</p>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 10, color: "#4a5a70", letterSpacing: "0.12em" }}>N° DU CERTIFICAT</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: BLUE, marginTop: 4 }}>{id}</p>
          </div>
          <div style={{ width: 230, textAlign: "center" }}>
            <p style={{ fontSize: 20, fontWeight: 700 }}>{date}</p>
            <div style={{ height: 1, background: NAVY, margin: "6px 0 5px" }} />
            <p style={{ fontSize: 12, color: "#4a5a70" }}>Date de délivrance</p>
          </div>
        </div>
        <p className="absolute inset-x-0 bottom-9 text-center" style={{ fontSize: 11, color: "#4a5a70", letterSpacing: "0.08em" }}>Délivré par CampusMarket Academy · N° {id}</p>
      </div>
    </div>
  );
}

/** SVG autonome du certificat, utilisé pour l'export en image. */
export function certificateSvg({ name, course, date, id }: CertificateData) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="707" viewBox="0 0 1000 707" font-family="Georgia, serif">
<rect width="1000" height="707" fill="#fff"/><rect x="16" y="16" width="968" height="675" fill="none" stroke="${BLUE}" stroke-width="3"/><rect x="28" y="28" width="944" height="651" fill="none" stroke="${BLUE}" stroke-opacity=".5"/>
<text x="500" y="84" text-anchor="middle" fill="${BLUE}" font-size="15" font-weight="700" letter-spacing="5" font-family="Arial, sans-serif">CAMPUSMARKET ACADEMY</text>
<text x="500" y="150" text-anchor="middle" fill="${NAVY}" font-size="52" font-weight="700" font-family="Arial, sans-serif">Certificat de réussite</text>
<text x="500" y="205" text-anchor="middle" fill="#4a5a70" font-size="17" font-family="Arial, sans-serif">Ce certificat est décerné à</text>
<text x="500" y="270" text-anchor="middle" fill="${BLUE}" font-size="46" font-style="italic">${esc(name)}</text>
<line x1="310" y1="288" x2="690" y2="288" stroke="${BLUE}" stroke-opacity=".35" stroke-width="2"/>
<text x="500" y="330" text-anchor="middle" fill="#4a5a70" font-size="17" font-family="Arial, sans-serif">pour avoir suivi avec succès la formation</text>
<text x="500" y="382" text-anchor="middle" fill="${NAVY}" font-size="30" font-weight="700" font-family="Arial, sans-serif">${esc(course.title)}</text>
<text x="500" y="420" text-anchor="middle" fill="#4a5a70" font-size="15" font-family="Arial, sans-serif">${course.modules.length} modules · ${formatDuration(courseMinutes(course))} · niveau ${course.level.toLowerCase()}</text>
<text x="215" y="590" text-anchor="middle" fill="${NAVY}" font-size="28" font-style="italic">${esc(course.instructor.name)}</text><line x1="100" y1="600" x2="330" y2="600" stroke="${NAVY}"/><text x="215" y="620" text-anchor="middle" fill="#4a5a70" font-size="12" font-family="Arial, sans-serif">Formateur</text>
<text x="785" y="590" text-anchor="middle" fill="${NAVY}" font-size="20" font-weight="700" font-family="Arial, sans-serif">${esc(date)}</text><line x1="670" y1="600" x2="900" y2="600" stroke="${NAVY}"/><text x="785" y="620" text-anchor="middle" fill="#4a5a70" font-size="12" font-family="Arial, sans-serif">Date de délivrance</text>
<text x="500" y="662" text-anchor="middle" fill="#4a5a70" font-size="11" font-family="Arial, sans-serif">Délivré par CampusMarket Academy · N° ${esc(id)}</text>
</svg>`;
}

/** Convertit le certificat en PNG et déclenche le téléchargement. */
export async function downloadCertificatePng(data: CertificateData) {
  const svg = certificateSvg(data);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("Chargement du certificat impossible")); img.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = 2000; canvas.height = 1414;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  await new Promise<void>((resolve) => canvas.toBlob((blob) => {
    if (blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `certificat-${data.id}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    resolve();
  }, "image/png"));
}
