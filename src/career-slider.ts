import Swiper from 'swiper';
import { A11y, Keyboard, Navigation } from 'swiper/modules';
import 'swiper/css';

let slider: Swiper | undefined;
export function destroyCareerSlider() { slider?.destroy(true, true); slider = undefined; }
export function mountCareerSlider() {
  const route = document.querySelector<HTMLElement>('.career-route');
  const container = route?.querySelector<HTMLElement>('.career-swiper');
  if (!route || !container) return;
  slider = new Swiper(container, {
    modules: [Navigation, Keyboard, A11y], slidesPerView: 'auto', spaceBetween: 10,
    initialSlide: Number(container.dataset.current ?? 0), centeredSlides: true, centeredSlidesBounds: true,
    watchOverflow: true, grabCursor: true, keyboard: {enabled: true, onlyInViewport: true},
    navigation: {prevEl: route.querySelector<HTMLElement>('.career-prev'), nextEl: route.querySelector<HTMLElement>('.career-next')},
    // Keep each card's own accessible label, including its progress and lock.
    a11y: {prevSlideMessage: 'Предыдущие этапы', nextSlideMessage: 'Следующие этапы', slideLabelMessage: ''},
  });
}
