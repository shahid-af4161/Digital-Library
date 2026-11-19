// public/js/script.js
// Small browser-side helpers.

document.addEventListener('DOMContentLoaded', function () {
  // Ask for confirmation before submitting any form that has a data-confirm message
  // (used for Delete, Return and Mark Paid buttons).
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.getAttribute('data-confirm'))) {
        event.preventDefault();
      }
    });
  });

  // Hide success/error messages automatically after 6 seconds
  document.querySelectorAll('.alert-dismissible').forEach(function (alertBox) {
    setTimeout(function () {
      if (window.bootstrap) {
        window.bootstrap.Alert.getOrCreateInstance(alertBox).close();
      }
    }, 6000);
  });
});
