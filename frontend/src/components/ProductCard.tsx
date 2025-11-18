import svgPaths from "../imports/svg-abrjor0i6o";

interface ProductCardProps {
  id: number;
  name: string;
  price: string;
  image: string;
  category: string;
  onTryOn: () => void;
  onClick: () => void;
  onVideoShopping: () => void;
}

export function ProductCard({
  name,
  image,
  onTryOn,
  onClick,
  onVideoShopping,
}: ProductCardProps) {
  return (
    <div className="bg-[#fcf8f6] relative rounded-[26.133px] w-full" data-name="Product Card">
      <div className="content-stretch flex flex-col items-center justify-center overflow-clip relative rounded-[inherit] size-full">
        <button
          onClick={onClick}
          className="aspect-[450/450] relative shrink-0 w-full hover:opacity-90 transition-opacity"
          data-name="Vector"
        >
          <img alt={name} className="block max-w-none size-full object-contain" src={image} />
        </button>
        <div className="relative shrink-0 w-full" data-name="Product Info">
          <div className="size-full">
            <div className="box-border content-stretch flex flex-col gap-[12px] items-start pb-[24px] pt-[16px] px-[24px] relative w-full">
              <div className="content-stretch flex flex-col gap-[26.133px] items-start relative shrink-0 w-full" data-name="Product Name Container">
                <div className="content-stretch flex flex-col gap-[4.356px] items-start relative shrink-0 w-full" data-name="Product Name Container">
                  <p className="-webkit-box css-qpoi1n font-['Montserrat:Regular',_sans-serif] font-normal leading-[normal] min-w-full overflow-ellipsis overflow-hidden relative shrink-0 text-[#7c563d] text-[24px] w-[min-content]">
                    {name}
                  </p>
                </div>
              </div>
              <div className="content-stretch flex items-center justify-between relative shrink-0 w-full" data-name="Product Actions">
                <div className="flex flex-row items-center self-stretch">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onVideoShopping();
                    }}
                    className="box-border content-stretch flex h-full items-center justify-center px-[16px] py-[8px] relative rounded-[8.711px] shrink-0 hover:bg-[#7c563d]/5 transition-colors" 
                    data-name="Video shopping Button"
                  >
                    <div aria-hidden="true" className="absolute border-2 border-[#7c563d] border-solid inset-0 pointer-events-none rounded-[8.711px]" />
                    <div className="box-border content-stretch flex flex-col items-start px-[2px] py-[8px] relative shrink-0 size-[32px]" data-name="Video Icon">
                      <div className="h-[16.696px] relative shrink-0 w-[29.217px]" data-name="Video icon">
                        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 30 17">
                          <g id="Video icon">
                            <g id="Vector">
                              <path d={svgPaths.p11f20b00} fill="var(--fill-0, #7C563D)" />
                              <path d={svgPaths.p3fa8170} fill="var(--fill-0, #7C563D)" />
                            </g>
                          </g>
                        </svg>
                      </div>
                    </div>
                  </button>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onTryOn();
                  }}
                  className="bg-[#7c563d] box-border content-stretch flex gap-[12px] items-center justify-center pl-[20px] pr-[24px] py-[12px] relative rounded-[12px] shrink-0 hover:bg-[#6a4a33] transition-colors" 
                  data-name="Try On Button"
                >
                  <div className="overflow-clip relative shrink-0 size-[24px]" data-name="Try On Icon">
                    <div className="absolute inset-[8.33%_8.33%_12.5%_8.33%]" data-name="Icon">
                      <div className="absolute inset-[-5.26%_-5%]" style={{ "--stroke-0": "rgba(252, 245, 241, 1)" } as React.CSSProperties}>
                        <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 22 21">
                          <g id="Icon">
                            <path d={svgPaths.p18c8e600} stroke="var(--stroke-0, #FCF5F1)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                            <path d={svgPaths.p3fd92680} stroke="var(--stroke-0, #FCF5F1)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                          </g>
                        </svg>
                      </div>
                    </div>
                  </div>
                  <p className="font-['Montserrat:Medium',_sans-serif] font-medium leading-[normal] relative shrink-0 text-[#fcf5f1] text-[20px] text-nowrap whitespace-pre">Try On </p>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="absolute border border-[#ecbd9f] border-solid inset-[-1px] pointer-events-none rounded-[27.133px]" />
    </div>
  );
}
