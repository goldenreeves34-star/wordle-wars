// Shows the "today's word isn't done" notification. Every push shows one (iPhone drops sites whose pushes show nothing).
self.addEventListener("push", e => {
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
