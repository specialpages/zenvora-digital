(function () {
  'use strict';

  /* ---------- Mobile menu ---------- */
  function initMenu() {
    var toggle = document.querySelector('[data-menu-toggle]');
    var nav = document.getElementById('MobileNav');
    if (!toggle || !nav || toggle.dataset.ready) return;
    toggle.dataset.ready = '1';
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.hidden = open;
    });
  }

  /* ---------- Header shadow on scroll ---------- */
  function initHeader() {
    var header = document.querySelector('[data-header]');
    if (!header) return;
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Reveal on scroll ---------- */
  var observer = null;
  function initReveal() {
    var items = document.querySelectorAll('.reveal:not(.is-in)');
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    }
    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- Product page ---------- */
  function initProduct() {
    var section = document.querySelector('[data-product-section]');
    if (!section || section.dataset.ready) return;
    section.dataset.ready = '1';

    // Thumbnails
    var mainImg = section.querySelector('[data-main-image] img');
    section.querySelectorAll('[data-thumb]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (mainImg) {
          mainImg.removeAttribute('srcset');
          mainImg.src = btn.getAttribute('data-thumb');
        }
        section.querySelectorAll('.thumb').forEach(function (t) { t.classList.remove('is-active'); });
        btn.classList.add('is-active');
      });
    });

    // Variant select
    var select = section.querySelector('[data-variant-select]');
    var idInput = section.querySelector('[data-variant-id]');
    var priceEl = section.querySelector('[data-price]');
    var compareEl = section.querySelector('[data-compare]');
    var saveEl = section.querySelector('[data-save]');
    var addBtn = section.querySelector('[data-add-button]');
    var addLabel = section.querySelector('[data-add-label]');
    var stickyPrice = document.querySelector('[data-sticky-price]');
    var stickyBtn = document.querySelector('[data-sticky-buy] button');

    if (select && idInput) {
      select.addEventListener('change', function () {
        var opt = select.options[select.selectedIndex];
        var available = opt.getAttribute('data-available') === 'true';
        var compare = opt.getAttribute('data-compare');
        idInput.value = opt.value;
        if (priceEl) priceEl.textContent = opt.getAttribute('data-price');
        if (stickyPrice) stickyPrice.textContent = opt.getAttribute('data-price');
        if (compareEl) {
          compareEl.textContent = compare || '';
          compareEl.hidden = !compare;
        }
        if (saveEl) saveEl.hidden = !compare;
        if (addBtn) addBtn.disabled = !available;
        if (stickyBtn) stickyBtn.disabled = !available;
        if (addLabel) addLabel.textContent = available ? 'Add to cart' : 'Sold out';
        if (window.history && window.history.replaceState) {
          var url = new URL(window.location.href);
          url.searchParams.set('variant', opt.value);
          window.history.replaceState({}, '', url.toString());
        }
      });
    }

    // Sticky mobile buy bar: show once the main buttons scroll out of view
    var bar = document.querySelector('[data-sticky-buy]');
    if (bar && addBtn && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        var visible = entries[0].isIntersecting;
        var below = entries[0].boundingClientRect.top < 0;
        bar.hidden = visible || !below;
      });
      io.observe(addBtn);
    }
  }

  /* ---------- Collection sort ---------- */
  function initSort() {
    var select = document.querySelector('[data-sort-select]');
    var form = document.querySelector('[data-sort-form]');
    if (!select || !form || select.dataset.ready) return;
    select.dataset.ready = '1';
    select.addEventListener('change', function () { form.submit(); });
  }

  /* ---------- Cart quantity auto-update ---------- */
  function initCart() {
    var form = document.querySelector('[data-cart-form]');
    if (!form || form.dataset.ready) return;
    form.dataset.ready = '1';
    var timer;
    form.querySelectorAll('[data-cart-qty]').forEach(function (input) {
      input.addEventListener('change', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var update = form.querySelector('button[name="update"]');
          if (update) update.click();
        }, 350);
      });
    });
  }

  function init() {
    initMenu();
    initHeader();
    initReveal();
    initProduct();
    initSort();
    initCart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init when sections are edited in the theme editor
  document.addEventListener('shopify:section:load', init);
})();
