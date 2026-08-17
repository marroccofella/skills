/** Tailwind theme extension measured from the live Promptus app, 2026-08-15. */
module.exports = {
  theme: {
    extend: {
      colors: {
        'promptus-dark-blue': '#190A4E',
        'promptus-dark-purple': '#34206D',
        'promptus-medium-blue': '#2A1B83',
        'promptus-yellow': '#FFB02E',
        'promptus-yellow-deep': '#FF9500',
        'promptus-cyan': '#12CEC6',
        'promptus-icon-muted': '#D1CEDC'
      },
      fontFamily: {
        promptus: [
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
          'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans',
          'Helvetica Neue', 'sans-serif'
        ]
      },
      borderRadius: {
        'promptus-control': '8px',
        'promptus-panel': '12px',
        'promptus-large': '16px'
      },
      boxShadow: {
        'promptus-card': '0 20px 25px -5px rgba(0,0,0,.10), 0 8px 10px -6px rgba(0,0,0,.10)',
        'promptus-drawer': '0 25px 50px -12px rgba(0,0,0,.25)'
      },
      backgroundImage: {
        'promptus-app': "url('./assets/promptus-background.jpg')"
      }
    }
  }
};
