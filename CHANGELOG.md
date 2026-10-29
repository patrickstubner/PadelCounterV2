# Changelog

## 2.2.2

- iPhone Safari can join a live match from the in-app camera. The scanner reads a centred square of about 480-720 pixels instead of the full camera frame, and it does not start a second decode while one is still running.
- A join link is accepted when this page was opened as `index.html`, with a trailing slash, or with a query such as `?source=pwa`. The token still has to be in the fragment of a same-origin link for `/PadelCounterV2`.
- If the camera starts but the picture cannot play, Join match says so. A QR that is not a join link shows “That code did not work.” A recognised join link closes the dialog and joins the same way as a typed code.
