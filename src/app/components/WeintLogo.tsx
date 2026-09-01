// weint 品牌图标：官网（weintdata.com）顶栏左上角 logo 的彩色「W」标记。
// 取自顶栏内联 SVG（viewBox 0 0 133 20 中左半段），由 5 段矢量路径组成，青蓝渐变。
// size 作为高度，宽度按原生比例 54:20 ≈ 2.7:1 缩放。
const W_PATHS: { d: string; fill: string }[] = [
  {
    d: "M53.8627 8.42717L51.1055 0H44.8533L47.5716 8.42717H53.8627Z",
    fill: "#06BDD2",
  },
  {
    d: "M19.2615 0L22.0187 8.42717H15.7276L13.0093 0H19.2615ZM16.7374 11.5728H23.0285L25.7469 20H19.4946L16.7374 11.5728Z",
    fill: "#0B55B6",
  },
  {
    d: "M25.9799 0H32.2321L25.7469 20H19.4946L25.9799 0ZM35.4165 0H41.6688L35.1835 20H28.9313L35.4165 0Z",
    fill: "#0091CE",
  },
  {
    d: "M51.1054 0H44.8532L38.3679 20H44.6202L51.1054 0Z",
    fill: "#42CDDD",
  },
  {
    d: "M12.7764 20H6.48526L0 0H6.29109L9.64019 10.3283L13.0093 0H19.2616L12.7764 20Z",
    fill: "#226ED2",
  },
];

export function WeintLogo({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const height = size;
  const width = size * (54 / 20);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 54 20"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {W_PATHS.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill}
          fillRule="evenodd"
          clipRule="evenodd"
        />
      ))}
    </svg>
  );
}
