export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';
export const currentRoute = () => STATIC_DEMO ? (window.location.hash.startsWith('#/') ? window.location.hash.slice(1) : '/') : window.location.pathname;
export const appHref = (path:string) => STATIC_DEMO ? `${import.meta.env.BASE_URL}#${path}` : path;
export const navigateTo = (path:string) => { if(STATIC_DEMO) window.location.hash=path; else window.history.pushState({},'',path); };
