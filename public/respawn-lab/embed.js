// Keep the embedded trainer at its content height without nested scrolling.
if (window.parent !== window) {
  let previousHeight = 0;
  const reportHeight = () => {
    const height = Math.ceil(document.querySelector('.app').getBoundingClientRect().height);
    if (height !== previousHeight) {
      previousHeight = height;
      window.parent.postMessage({ type: 'respawn-lab:height', height }, window.location.origin);
    }
  };
  new ResizeObserver(reportHeight).observe(document.querySelector('.app'));
  window.addEventListener('load', reportHeight);
  reportHeight();
}
