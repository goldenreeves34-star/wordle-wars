// Shows the "today's word isn't done" notification. Every push shows one (iPhone drops sites whose pushes show nothing).
// Pushes only go to phones whose player hasn't finished today, so each one also puts a red 1 on the app icon;
// the page clears it once today's word is played or logged.
self.addEventListener("push", e => {
  if (navigator.setAppBadge) e.waitUntil(navigator.setAppBadge(1).catch(() => {}));
  e.waitUntil(self.registration.showNotification("Wordle Wars", {
    body: "Today's word isn't done yet. Play or log it before midnight.",
    icon: "apple-touch-icon.png",
    tag: "ww-daily"
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window" }).then(list => list[0] ? list[0].focus() : clients.openWindow("/")));
});
