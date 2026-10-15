mu <- fitted(model_freq, what = "mu")

head(data.frame(
  i = freq$i,
  j = freq$j,
  N = freq$N,
  mu = mu
), 5)
