export function BaseLogo({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 111 111" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="55.5" cy="55.5" r="55.5" fill="#0052FF"/>
      <path 
        d="M55.4 93.25c20.9 0 37.85-16.95 37.85-37.85S76.3 17.55 55.4 17.55c-18.82 0-34.4 13.74-37.33 31.73h49.18v14.34H18.07c2.93 17.99 18.51 31.73 37.33 31.73z" 
        fill="white"
      />
    </svg>
  );
}

export function MegaETHLogo({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="46" stroke="#3a3a3a" strokeWidth="8" fill="none"/>
      <text 
        x="50" 
        y="52" 
        textAnchor="middle" 
        dominantBaseline="middle"
        fill="#3a3a3a" 
        fontSize="36" 
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
      >
        M
      </text>
      <circle cx="38" cy="68" r="6" fill="#3a3a3a"/>
      <circle cx="62" cy="68" r="6" fill="#3a3a3a"/>
    </svg>
  );
}

export function MegaETHLogoSimple({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="8" fill="none"/>
      <text 
        x="50" 
        y="48" 
        textAnchor="middle" 
        dominantBaseline="middle"
        fill="currentColor" 
        fontSize="38" 
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
      >
        M
      </text>
      <circle cx="38" cy="68" r="6" fill="currentColor"/>
      <circle cx="62" cy="68" r="6" fill="currentColor"/>
    </svg>
  );
}
