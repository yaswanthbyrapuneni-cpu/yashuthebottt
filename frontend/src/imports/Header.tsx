import svgPaths from "./svg-2iy52myn9q";

function Logo() {
  return (
    <div className="content-stretch flex gap-[10px] items-center justify-center relative shrink-0" data-name="logo">
      <p className="font-['Playfair_Display:Regular',_sans-serif] font-normal leading-[normal] relative shrink-0 text-[#2a120a] text-[60px] text-nowrap whitespace-pre">Alankara AI</p>
    </div>
  );
}

function SearchIcon() {
  return (
    <div className="relative shrink-0 size-[64px]" data-name="Search Icon">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 64 64">
        <g id="Search Icon">
          <path d={svgPaths.p1b92c370} id="Icon" stroke="var(--stroke-0, #7C563D)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
        </g>
      </svg>
    </div>
  );
}

function SearchContainer() {
  return (
    <div className="content-stretch flex gap-[48px] items-center relative shrink-0" data-name="Search Container">
      <SearchIcon />
    </div>
  );
}

function LogOut01() {
  return (
    <div className="relative shrink-0 size-[64px]" data-name="log-out-01">
      <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 64 64">
        <g id="log-out-01">
          <path d={svgPaths.p9897f40} id="Icon" stroke="var(--stroke-0, #7C563D)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5.33333" />
        </g>
      </svg>
    </div>
  );
}

function Frame217() {
  return (
    <div className="content-stretch flex gap-[24px] items-center relative shrink-0">
      <SearchContainer />
      <LogOut01 />
    </div>
  );
}

export default function Header() {
  return (
    <div className="bg-[#f6e1d2] relative size-full" data-name="Header">
      <div aria-hidden="true" className="absolute border-[#eaecf0] border-[0px_0px_4px] border-solid inset-0 pointer-events-none" />
      <div className="flex flex-row items-center size-full">
        <div className="box-border content-stretch flex items-center justify-between px-[96px] py-[48px] relative size-full">
          <Logo />
          <Frame217 />
        </div>
      </div>
    </div>
  );
}