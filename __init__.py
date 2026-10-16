aggregate(
  l ~ r + m,
  data = subset(wd, i == 2000 & m <= 3),
  FUN = function(x) c(
    min = min(x),
    max = max(x),
    liczba = length(x)
  )
)
