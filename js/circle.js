var circle;

circle = new ProgressBar.Line("#progress-bar", {
  color: "#c0392b",
  strokeWidth: 2,
  trailWidth: 2,
  easing: "easeInOut",
  duration: 1400,
  text: {
    autoStyleContainer: false,
  },
  from: { color: "#c0392b", width: 2 },
  to: { color: "#c0392b", width: 2 },
  step: function (state, circle) {
    circle.path.setAttribute("stroke", state.color);
    circle.path.setAttribute("stroke-width", state.width);

    var value = Math.round(circle.value() * 100);
    if (value === 0) {
      circle.setText("0%");
    } else {
      circle.setText(`${value}%`);
    }
  },
});

circle.text.style.fontFamily = "'Courier New', monospace";
circle.text.style.fontSize = "9px";
circle.text.style.color = "#c0392b";
circle.text.style.fontWeight = "600";
circle.text.style.letterSpacing = "0.08em";
